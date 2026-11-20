import { emailSchema, PASSWORD_MIN_LENGTH, passwordSchema } from "@delyra/shared";
import { apiFetch, AuthLayout, Button, errorMessage, Field, FormError, toast } from "@delyra/ui";
import { Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { apiFieldErrors, type FieldErrors, formValues, useFragmentToken } from "./form";
import { useTurnstile } from "./use-turnstile";

const backToLogin = (
  <Link
    to="/login"
    search={{ next: undefined }}
    className="underline underline-offset-4 hover:text-foreground"
  >
    Volver a iniciar sesión
  </Link>
);

/** Solicitud del enlace de recuperación. La respuesta es la misma exista o no la cuenta. */
export function ForgotPasswordPage() {
  const turnstile = useTurnstile("password_forgot");
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | undefined>();
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const email = emailSchema.safeParse(formValues(event.currentTarget).email);
    setEmailError(email.success ? undefined : email.error.issues[0]?.message);
    if (!email.success) return;
    if (!turnstile.token) {
      setError("Completa la verificación anti-bots.");
      return;
    }
    setPending(true);
    try {
      await apiFetch("/api/auth/password/forgot", {
        method: "POST",
        body: { email: email.data, turnstileToken: turnstile.token },
      });
      setSent(true);
    } catch (caught) {
      setError(errorMessage(caught));
      turnstile.reset();
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <AuthLayout
        title="Revisa tu correo"
        description="Si hay una cuenta con ese email, te hemos enviado un enlace para elegir una contraseña nueva. Caduca en 30 minutos."
        footer={backToLogin}
      >
        <span />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Recuperar la contraseña"
      description="Te enviaremos un enlace para elegir otra. Tu verificación en dos pasos no cambia."
      footer={backToLogin}
    >
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="grid gap-4">
        <FormError>{error}</FormError>
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          autoFocus
          error={emailError}
        />
        {turnstile.element}
        <Button type="submit" disabled={pending}>
          {pending ? "Enviando…" : "Enviar enlace"}
        </Button>
      </form>
    </AuthLayout>
  );
}

/** Nueva contraseña desde el enlace del correo (`/restablecer#token=…`). */
export function ResetPasswordPage() {
  const token = useFragmentToken();
  const navigate = useNavigate();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const values = formValues(event.currentTarget);
    const password = passwordSchema.safeParse(values.password);
    const found: FieldErrors = {};
    if (!password.success) found.password = password.error.issues[0]?.message;
    else if (values.password !== values.confirm) found.confirm = "Las contraseñas no coinciden";
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setPending(true);
    try {
      await apiFetch("/api/auth/password/reset", {
        method: "POST",
        body: { token, password: values.password },
      });
      toast.success("Contraseña cambiada. Inicia sesión con la nueva.");
      await navigate({ to: "/login", search: { next: undefined } });
    } catch (caught) {
      setErrors(apiFieldErrors(caught));
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  if (!token) {
    return (
      <AuthLayout
        title="Enlace no válido"
        description="El enlace está incompleto. Ábrelo directamente desde el correo o pide otro."
        footer={backToLogin}
      >
        <Button asChild className="w-full">
          <Link to="/recuperar">Pedir otro enlace</Link>
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Elige una contraseña nueva"
      description="Se cerrarán todas tus sesiones abiertas."
      footer={backToLogin}
    >
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="grid gap-4">
        <FormError>{error}</FormError>
        <Field
          label="Contraseña nueva"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          autoFocus
          minLength={PASSWORD_MIN_LENGTH}
          hint={`Mínimo ${String(PASSWORD_MIN_LENGTH)} caracteres.`}
          error={errors.password}
        />
        <Field
          label="Repite la contraseña"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          error={errors.confirm}
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : "Cambiar contraseña"}
        </Button>
      </form>
    </AuthLayout>
  );
}
