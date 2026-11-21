import { totpConfirmResponseSchema, totpSetupResponseSchema } from "@delyra/shared";
import {
  apiFetch,
  AuthLayout,
  Button,
  errorMessage,
  Field,
  FormError,
  FullPageSpinner,
  goTo,
  ME_QUERY_KEY,
  resolveNext,
  useMe,
} from "@delyra/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";
import { formValues, useNextParam } from "./form";
import { RecoveryCodeList, SavedCodesConfirmation, TotpQr } from "./totp-parts";

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  return (
    <AuthLayout
      title="Guarda tus códigos de recuperación"
      description="Si pierdes el móvil, cada uno de estos códigos te deja entrar una vez. No volverás a verlos."
    >
      <div className="grid gap-4">
        <RecoveryCodeList codes={codes} />
        <SavedCodesConfirmation onDone={onDone} />
      </div>
    </AuthLayout>
  );
}

/** Alta obligatoria del TOTP: QR, confirmación con un código y códigos de recuperación. */
export function TotpSetupPage() {
  const next = useNextParam();
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useMe();
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const state = me.data?.state;

  // Cada llamada genera una semilla nueva: una sola vez y sin refrescos automáticos.
  const setup = useQuery({
    queryKey: ["auth", "totp-setup"],
    enabled: state === "pending_totp",
    queryFn: () =>
      apiFetch("/api/auth/totp/setup", { method: "POST", schema: totpSetupResponseSchema }),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  useEffect(() => {
    if (codes) return;
    if (state === "active") goTo(resolveNext(next), (path) => router.history.replace(path));
    if (state === "pending_2fa") {
      void router.navigate({ to: "/login/verificar", search: { next }, replace: true });
    }
    if (state === "anonymous") {
      void router.navigate({ to: "/login", search: { next }, replace: true });
    }
  }, [state, next, router, codes]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = (formValues(event.currentTarget).code ?? "").replace(/\s+/g, "");
    if (!/^\d{6}$/.test(code)) {
      setFormError("Introduce los 6 dígitos que muestra tu app.");
      return;
    }
    setFormError(null);
    setPending(true);
    try {
      const result = await apiFetch("/api/auth/totp/confirm", {
        method: "POST",
        body: { code },
        schema: totpConfirmResponseSchema,
      });
      setCodes(result.recoveryCodes);
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  if (codes) {
    return (
      <RecoveryCodes
        codes={codes}
        onDone={() => {
          void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }).then(() => {
            goTo(resolveNext(next), (path) => router.history.push(path));
          });
        }}
      />
    );
  }
  if (state !== "pending_totp") return <FullPageSpinner />;
  if (setup.isError) {
    return (
      <AuthLayout
        title="No se pudo preparar la verificación"
        description={errorMessage(setup.error)}
      >
        <Button className="w-full" onClick={() => void setup.refetch()}>
          Reintentar
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Activa la verificación en dos pasos"
      description="Es obligatoria. Escanea el código con una app autenticadora (Google Authenticator, 1Password, Bitwarden, Aegis…)."
    >
      <div className="grid gap-4">
        {setup.data ? (
          <TotpQr otpauthUri={setup.data.otpauthUri} secret={setup.data.secret} />
        ) : (
          <div className="mx-auto size-52 animate-pulse rounded-md bg-muted" />
        )}
        <form noValidate onSubmit={(event) => void onSubmit(event)} className="grid gap-4">
          <FormError>{formError}</FormError>
          <Field
            label="Código de 6 dígitos"
            name="code"
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            required
          />
          <Button type="submit" disabled={pending || !setup.data}>
            {pending ? "Comprobando…" : "Activar"}
          </Button>
        </form>
      </div>
    </AuthLayout>
  );
}
