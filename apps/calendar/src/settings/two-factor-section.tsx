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
import { PasskeysPanel } from "./passkeys-panel";
import { ReauthForm } from "./reauth-form";
import { Section } from "./section";
import { settingsMessages } from "./messages";

export const SECURITY_QUERY_KEY = ["account", "security"] as const;

function RegenerateCodesDialog({ onClose }: { onClose: () => void }) {
  const [codes, setCodes] = useState<string[] | null>(null);
  const t = settingsMessages().twoFactor;
  return (
    <Dialog open onOpenChange={(open) => !open && !codes && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.newCodesTitle}</DialogTitle>
          <DialogDescription>{codes ? t.newCodesSaved : t.newCodesConfirm}</DialogDescription>
        </DialogHeader>
        {codes ? (
          <div className="grid gap-4">
            <RecoveryCodeList codes={codes} />
            <SavedCodesConfirmation label={t.done} onDone={onClose} />
          </div>
        ) : (
          <ReauthForm
            submitLabel={t.generate}
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
  const t = settingsMessages();

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = (formValues(event.currentTarget).code ?? "").replace(/\s+/g, "");
    if (!/^\d{6}$/.test(code)) {
      setError(t.twoFactor.newAppDigits);
      return;
    }
    setError(null);
    setPending(true);
    try {
      await apiFetch("/api/me/totp/reconfigure/confirm", { method: "POST", body: { code } });
      toast.success(t.twoFactor.appChanged);
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
          <DialogTitle>{t.twoFactor.changeApp}</DialogTitle>
          <DialogDescription>
            {enrollment ? t.twoFactor.changeAppScan : t.twoFactor.changeAppConfirm}
          </DialogDescription>
        </DialogHeader>
        {enrollment ? (
          <div className="grid gap-4">
            <TotpQr otpauthUri={enrollment.otpauthUri} secret={enrollment.secret} />
            <form noValidate onSubmit={(event) => void confirm(event)} className="grid gap-4">
              <FormError>{error}</FormError>
              <Field
                label={t.twoFactor.newAppCode}
                name="code"
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                required
              />
              <Button type="submit" disabled={pending}>
                {pending ? t.common.checking : t.twoFactor.useNewApp}
              </Button>
            </form>
          </div>
        ) : (
          <ReauthForm
            submitLabel={t.common.continue}
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
  const t = settingsMessages();

  return (
    <Section id="verificacion" title={t.twoFactor.title} description={t.twoFactor.description}>
      <dl className="mb-4 grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-md border p-3">
          <dt className="flex items-center gap-2 font-medium">
            <SmartphoneIcon aria-hidden="true" className="size-4" />
            {t.twoFactor.app}
          </dt>
          <dd className="mt-1 text-muted-foreground">
            {security.data?.totpConfirmedAt
              ? t.twoFactor.activeSince(formatDateTime(security.data.totpConfirmedAt, timeZone))
              : t.common.loading}
          </dd>
        </div>
        <div className="rounded-md border p-3">
          <dt className="flex items-center gap-2 font-medium">
            <KeyRoundIcon aria-hidden="true" className="size-4" />
            {t.twoFactor.recoveryCodes}
          </dt>
          <dd
            className={
              remaining !== undefined && remaining <= 3
                ? "mt-1 font-medium text-destructive"
                : "mt-1 text-muted-foreground"
            }
          >
            {remaining === undefined
              ? t.common.loading
              : remaining === 0
                ? t.twoFactor.noneLeft
                : t.twoFactor.left(remaining)}
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setDialog("totp")}>
          {t.twoFactor.changeApp}
        </Button>
        <Button variant="outline" onClick={() => setDialog("codes")}>
          {t.twoFactor.generate}
        </Button>
      </div>
      <div className="mt-5">
        <PasskeysPanel timeZone={timeZone} />
      </div>
      {dialog === "codes" ? <RegenerateCodesDialog onClose={close} /> : null}
      {dialog === "totp" ? <ReconfigureTotpDialog onClose={close} /> : null}
    </Section>
  );
}
