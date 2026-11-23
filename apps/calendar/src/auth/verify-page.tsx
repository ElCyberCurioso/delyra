import { secondFactorResponseSchema, webauthnOptionsResponseSchema } from "@delyra/shared";
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
  toast,
  useMe,
} from "@delyra/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import { FingerprintIcon } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { formValues, useNextParam } from "./form";
import { authMessages } from "./messages";
import { getPasskeyAssertion, passkeyErrorKind, passkeysSupported } from "./passkeys";

/**
 * Segundo paso del login: llave de acceso (F7-09), código de la app autenticadora o código de
 * recuperación.
 */
export function VerifyPage() {
  const next = useNextParam();
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useMe();
  const [useRecovery, setUseRecovery] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const t = authMessages();

  const state = me.data?.state;
  useEffect(() => {
    if (state === "active") goTo(resolveNext(next), (path) => router.history.replace(path));
    if (state === "pending_totp") {
      void router.navigate({ to: "/configurar-2fa", search: { next }, replace: true });
    }
  }, [state, next, router]);

  async function finish(remainingRecoveryCodes: number | null) {
    if (remainingRecoveryCodes !== null) {
      toast.warning(t.verify.remainingCodes(remainingRecoveryCodes));
    }
    await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    goTo(resolveNext(next), (path) => router.history.push(path));
  }

  async function withPasskey() {
    setFormError(null);
    setPending(true);
    try {
      const { options } = await apiFetch("/api/auth/login/passkey/options", {
        method: "POST",
        schema: webauthnOptionsResponseSchema,
      });
      const response = await getPasskeyAssertion(options);
      const result = await apiFetch("/api/auth/login/passkey", {
        method: "POST",
        body: { response },
        schema: secondFactorResponseSchema,
      });
      await finish(result.remainingRecoveryCodes);
    } catch (error) {
      setFormError(
        passkeyErrorKind(error) === "cancelled" ? t.verify.passkeyCancelled : errorMessage(error),
      );
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    } finally {
      setPending(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = (formValues(event.currentTarget).code ?? "").replace(/\s+/g, "");
    if (!useRecovery && !/^\d{6}$/.test(code)) {
      setFormError(t.common.sixDigits);
      return;
    }
    if (useRecovery && code.length < 10) {
      setFormError(t.verify.recoveryIncomplete);
      return;
    }
    setFormError(null);
    setPending(true);
    try {
      const result = await apiFetch("/api/auth/login/second-factor", {
        method: "POST",
        body: { code },
        schema: secondFactorResponseSchema,
      });
      await finish(useRecovery ? result.remainingRecoveryCodes : null);
    } catch (error) {
      setFormError(errorMessage(error));
      // Tras 5 fallos la sesión pendiente se revoca: hay que volver a empezar.
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    } finally {
      setPending(false);
    }
  }

  if (me.isPending || state === "active" || state === "pending_totp") return <FullPageSpinner />;

  if (state !== "pending_2fa") {
    return (
      <AuthLayout title={t.verify.expiredTitle} description={t.verify.expiredDescription}>
        <Button asChild className="w-full">
          <Link to="/login" search={{ next }}>
            {t.common.signIn}
          </Link>
        </Button>
      </AuthLayout>
    );
  }

  const offerPasskey = me.data?.passkey === true && passkeysSupported();

  return (
    <AuthLayout
      title={t.verify.title}
      description={
        useRecovery
          ? t.verify.recoveryDescription
          : offerPasskey
            ? t.verify.passkeyDescription
            : t.verify.totpDescription
      }
    >
      <div className="grid gap-4">
        <FormError>{formError}</FormError>
        {offerPasskey && !useRecovery ? (
          <div className="grid gap-4">
            <Button
              type="button"
              size="lg"
              disabled={pending}
              onClick={() => void withPasskey()}
              className="w-full"
            >
              <FingerprintIcon aria-hidden="true" />
              {pending ? t.verify.passkeyWaiting : t.verify.usePasskey}
            </Button>
            <p className="flex items-center gap-3 text-xs font-medium text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
              {t.verify.orCode}
            </p>
          </div>
        ) : null}
        <form noValidate onSubmit={(event) => void onSubmit(event)} className="grid gap-4">
          <Field
            key={useRecovery ? "recovery" : "totp"}
            label={useRecovery ? t.verify.recoveryCode : t.verify.code}
            name="code"
            autoComplete="one-time-code"
            inputMode={useRecovery ? "text" : "numeric"}
            pattern={useRecovery ? undefined : "[0-9]*"}
            maxLength={useRecovery ? 11 : 6}
            placeholder={useRecovery ? "xxxxx-xxxxx" : "123456"}
            autoFocus
            required
          />
          <Button type="submit" variant={offerPasskey ? "outline" : "default"} disabled={pending}>
            {pending ? t.verify.verifying : t.verify.verify}
          </Button>
          <Button
            variant="link"
            className="text-center"
            onClick={() => {
              setUseRecovery((value) => !value);
              setFormError(null);
            }}
          >
            {useRecovery ? t.verify.useApp : t.verify.useRecovery}
          </Button>
        </form>
      </div>
    </AuthLayout>
  );
}
