import { secondFactorResponseSchema } from "@delyra/shared";
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
import { formValues, useNextParam } from "./form";
import { type FormEvent, useEffect, useState } from "react";

/** Segundo paso del login: código de la app autenticadora o código de recuperación. */
export function VerifyPage() {
  const next = useNextParam();
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useMe();
  const [useRecovery, setUseRecovery] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const state = me.data?.state;
  useEffect(() => {
    if (state === "active") goTo(resolveNext(next), (path) => router.history.replace(path));
    if (state === "pending_totp") {
      void router.navigate({ to: "/configurar-2fa", search: { next }, replace: true });
    }
  }, [state, next, router]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = (formValues(event.currentTarget).code ?? "").replace(/\s+/g, "");
    if (!useRecovery && !/^\d{6}$/.test(code)) {
      setFormError("Introduce los 6 dígitos que muestra tu app.");
      return;
    }
    if (useRecovery && code.length < 10) {
      setFormError("Introduce un código de recuperación completo (xxxxx-xxxxx).");
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
      if (useRecovery) {
        toast.warning(
          `Te quedan ${String(result.remainingRecoveryCodes)} códigos de recuperación. Genera otros nuevos desde Ajustes si se agotan.`,
        );
      }
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      goTo(resolveNext(next), (path) => router.history.push(path));
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
      <AuthLayout title="Sesión caducada" description="Vuelve a introducir tu email y contraseña.">
        <Button asChild className="w-full">
          <Link to="/login" search={{ next }}>
            Iniciar sesión
          </Link>
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Verificación en dos pasos"
      description={
        useRecovery
          ? "Escribe uno de los códigos de recuperación que guardaste. Cada código sirve una vez."
          : "Abre tu app autenticadora y escribe el código de 6 dígitos de Delyra."
      }
    >
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="grid gap-4">
        <FormError>{formError}</FormError>
        <Field
          key={useRecovery ? "recovery" : "totp"}
          label={useRecovery ? "Código de recuperación" : "Código"}
          name="code"
          autoComplete="one-time-code"
          inputMode={useRecovery ? "text" : "numeric"}
          pattern={useRecovery ? undefined : "[0-9]*"}
          maxLength={useRecovery ? 11 : 6}
          placeholder={useRecovery ? "xxxxx-xxxxx" : "123456"}
          autoFocus
          required
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Verificando…" : "Verificar"}
        </Button>
        <Button
          variant="link"
          onClick={() => {
            setUseRecovery((value) => !value);
            setFormError(null);
          }}
        >
          {useRecovery
            ? "Usar la app autenticadora"
            : "No tengo el móvil: usar un código de recuperación"}
        </Button>
      </form>
    </AuthLayout>
  );
}
