import {
  recoveryCodesResponseSchema,
  securityOverviewResponseSchema,
  totpSetupResponseSchema,
} from "@delyra/shared";
import {
  type ActiveSession,
  apiFetch,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  errorMessage,
  Field,
  FormError,
  toast,
} from "@delyra/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRoundIcon, SmartphoneIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { formValues } from "../auth/form";
import { RecoveryCodeList, SavedCodesConfirmation, TotpQr } from "../auth/totp-parts";
import { formatDateTime } from "./format";
import { Section } from "./section";

export const SECURITY_QUERY_KEY = ["account", "security"] as const;

/** Formulario común: contraseña y código actual (TOTP o de recuperación). */
function ReauthForm({
  submitLabel,
  onSubmit,
}: {
  submitLabel: string;
  onSubmit: (values: { password: string; code: string }) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = formValues(event.currentTarget);
    const password = values.password ?? "";
    const code = (values.code ?? "").replace(/\s+/g, "");
    if (!password || code.length < 6) {
      setError("Escribe tu contraseña y un código de tu app (o de recuperación).");
      return;
    }
    setError(null);
    setPending(true);
    try {
      await onSubmit({ password, code });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <form noValidate onSubmit={(event) => void handle(event)} className="grid gap-4">
      <FormError>{error}</FormError>
      <Field
        label="Contraseña"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        autoFocus
      />
      <Field
        label="Código actual"
        name="code"
        autoComplete="one-time-code"
        hint="El de tu app autenticadora o un código de recuperación."
        maxLength={11}
        required
      />
      <Button type="submit" disabled={pending}>
        {pending ? "Comprobando…" : submitLabel}
      </Button>
    </form>
  );
}

function RegenerateCodesDialog({ onClose }: { onClose: () => void }) {
  const [codes, setCodes] = useState<string[] | null>(null);
  return (
    <Dialog open onOpenChange={(open) => !open && !codes && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Códigos de recuperación nuevos</DialogTitle>
          <DialogDescription>
            {codes
              ? "Los anteriores ya no valen. Guarda estos: no volverás a verlos."
              : "Confirma que eres tú. Los códigos que tienes ahora dejarán de valer."}
          </DialogDescription>
        </DialogHeader>
        {codes ? (
          <div className="grid gap-4">
            <RecoveryCodeList codes={codes} />
            <SavedCodesConfirmation label="Hecho" onDone={onClose} />
          </div>
        ) : (
          <ReauthForm
            submitLabel="Generar códigos nuevos"
            onSubmit={async (body) => {
              const result = await apiFetch("/api/me/recovery-codes", {
                method: "POST",
                body,
                schema: recoveryCodesResponseSchema,
              });
              setCodes(result.recoveryCodes);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReconfigureTotpDialog({ onClose }: { onClose: () => void }) {
  const [enrollment, setEnrollment] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = (formValues(event.currentTarget).code ?? "").replace(/\s+/g, "");
    if (!/^\d{6}$/.test(code)) {
      setError("Introduce los 6 dígitos que muestra la app nueva.");
      return;
    }
    setError(null);
    setPending(true);
    try {
      await apiFetch("/api/me/totp/reconfigure/confirm", { method: "POST", body: { code } });
      toast.success("App autenticadora cambiada. Se han cerrado tus otras sesiones.");
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cambiar de app autenticadora</DialogTitle>
          <DialogDescription>
            {enrollment
              ? "Escanea el código con la app nueva y escribe el código que muestre. Hasta entonces sigue valiendo la anterior."
              : "Confirma que eres tú con tu contraseña y el código actual."}
          </DialogDescription>
        </DialogHeader>
        {enrollment ? (
          <div className="grid gap-4">
            <TotpQr otpauthUri={enrollment.otpauthUri} secret={enrollment.secret} />
            <form noValidate onSubmit={(event) => void confirm(event)} className="grid gap-4">
              <FormError>{error}</FormError>
              <Field
                label="Código de la app nueva"
                name="code"
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                required
              />
              <Button type="submit" disabled={pending}>
                {pending ? "Comprobando…" : "Usar la app nueva"}
              </Button>
            </form>
          </div>
        ) : (
          <ReauthForm
            submitLabel="Continuar"
            onSubmit={async (body) => {
              setEnrollment(
                await apiFetch("/api/me/totp/reconfigure", {
                  method: "POST",
                  body,
                  schema: totpSetupResponseSchema,
                }),
              );
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Estado del 2FA, regeneración de códigos y cambio de app autenticadora. */
export function TwoFactorSection({ session }: { session: ActiveSession }) {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<"codes" | "totp" | null>(null);
  const security = useQuery({
    queryKey: SECURITY_QUERY_KEY,
    queryFn: ({ signal }) =>
      apiFetch("/api/me/security", { schema: securityOverviewResponseSchema, signal }),
  });

  function close() {
    setDialog(null);
    void queryClient.invalidateQueries({ queryKey: ["account"] });
  }

  const remaining = security.data?.remainingRecoveryCodes;
  const timeZone = session.settings.timeZone;

  return (
    <Section
      id="verificacion"
      title="Verificación en dos pasos"
      description="Obligatoria en Delyra. Para cambiar algo te pediremos la contraseña y un código."
    >
      <dl className="mb-4 grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-md border p-3">
          <dt className="flex items-center gap-2 font-medium">
            <SmartphoneIcon aria-hidden="true" className="size-4" />
            App autenticadora
          </dt>
          <dd className="mt-1 text-muted-foreground">
            {security.data?.totpConfirmedAt
              ? `Activa desde el ${formatDateTime(security.data.totpConfirmedAt, timeZone)}`
              : "Cargando…"}
          </dd>
        </div>
        <div className="rounded-md border p-3">
          <dt className="flex items-center gap-2 font-medium">
            <KeyRoundIcon aria-hidden="true" className="size-4" />
            Códigos de recuperación
          </dt>
          <dd
            className={
              remaining !== undefined && remaining <= 3
                ? "mt-1 font-medium text-destructive"
                : "mt-1 text-muted-foreground"
            }
          >
            {remaining === undefined
              ? "Cargando…"
              : remaining === 0
                ? "No te queda ninguno: genera códigos nuevos."
                : `Te quedan ${String(remaining)} de 10.`}
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setDialog("totp")}>
          Cambiar de app autenticadora
        </Button>
        <Button variant="outline" onClick={() => setDialog("codes")}>
          Generar códigos nuevos
        </Button>
      </div>
      {dialog === "codes" ? <RegenerateCodesDialog onClose={close} /> : null}
      {dialog === "totp" ? <ReconfigureTotpDialog onClose={close} /> : null}
    </Section>
  );
}
