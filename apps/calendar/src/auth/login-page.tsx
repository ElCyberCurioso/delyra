import { authStepResponseSchema, loginRequestSchema } from "@delyra/shared";
import { apiFetch, AuthLayout, Button, errorMessage, Field, FormError } from "@delyra/ui";
import { Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { type FieldErrors, formValues, useNextParam, validate } from "./form";
import { useTurnstile } from "./use-turnstile";

export function LoginPage() {
  const next = useNextParam();
  const navigate = useNavigate();
  const turnstile = useTurnstile("login");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const { data, errors } = validate(loginRequestSchema, {
      ...formValues(event.currentTarget),
      turnstileToken: turnstile.token ?? "",
    });
    setErrors(errors ?? {});
    if (!data) return;
    setPending(true);
    try {
      const step = await apiFetch("/api/auth/login", {
        method: "POST",
        body: data,
        schema: authStepResponseSchema,
      });
      await navigate({
        to: step.next === "totp-setup" ? "/configurar-2fa" : "/login/verificar",
        search: { next },
      });
    } catch (error) {
      setFormError(errorMessage(error));
      turnstile.reset();
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthLayout
      title="Iniciar sesión"
      description="Accede a tu calendario y a tus tableros."
      footer={
        <Link to="/recuperar" className="underline underline-offset-4 hover:text-foreground">
          ¿Has olvidado la contraseña?
        </Link>
      }
    >
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="grid gap-4">
        <FormError>{formError}</FormError>
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          autoFocus
          error={errors.email}
        />
        <Field
          label="Contraseña"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          error={errors.password}
        />
        {turnstile.element}
        {errors.turnstileToken && !formError ? (
          <p className="text-sm text-destructive">{errors.turnstileToken}</p>
        ) : null}
        <Button type="submit" disabled={pending}>
          {pending ? "Comprobando…" : "Continuar"}
        </Button>
      </form>
    </AuthLayout>
  );
}
