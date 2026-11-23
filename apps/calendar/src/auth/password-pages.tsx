import { emailSchema, PASSWORD_MIN_LENGTH, passwordSchema } from "@delyra/shared";
import { apiFetch, AuthLayout, Button, errorMessage, Field, FormError, toast } from "@delyra/ui";
import { Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { apiFieldErrors, type FieldErrors, formValues, useFragmentToken } from "./form";
import { useTurnstile } from "./use-turnstile";
import { authMessages } from "./messages";

function BackToLogin() {
  return (
    <Link
      to="/login"
      search={{ next: undefined }}
      className="underline underline-offset-4 hover:text-foreground"
    >
      {authMessages().common.backToLogin}
    </Link>
  );
}

/** Solicitud del enlace de recuperación. La respuesta es la misma exista o no la cuenta. */
export function ForgotPasswordPage() {
  const turnstile = useTurnstile("password_forgot");
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | undefined>();
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const t = authMessages();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const email = emailSchema.safeParse(formValues(event.currentTarget).email);
    setEmailError(email.success ? undefined : email.error.issues[0]?.message);
    if (!email.success) return;
    if (!turnstile.token) {
      setError(t.common.completeTurnstile);
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
        title={t.forgot.sentTitle}
        description={t.forgot.sentDescription}
        footer={<BackToLogin />}
      >
        <span />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t.forgot.title} description={t.forgot.description} footer={<BackToLogin />}>
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="grid gap-4">
        <FormError>{error}</FormError>
        <Field
          label={t.common.email}
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
          {pending ? t.forgot.sending : t.forgot.send}
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
  const t = authMessages();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const values = formValues(event.currentTarget);
    const password = passwordSchema.safeParse(values.password);
    const found: FieldErrors = {};
    if (!password.success) found.password = password.error.issues[0]?.message;
    else if (values.password !== values.confirm) found.confirm = t.common.passwordsDontMatch;
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setPending(true);
    try {
      await apiFetch("/api/auth/password/reset", {
        method: "POST",
        body: { token, password: values.password },
      });
      toast.success(t.reset.changed);
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
        title={t.reset.invalidTitle}
        description={t.reset.invalidDescription}
        footer={<BackToLogin />}
      >
        <Button asChild className="w-full">
          <Link to="/recuperar">{t.reset.requestAnother}</Link>
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t.reset.title} description={t.reset.description} footer={<BackToLogin />}>
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="grid gap-4">
        <FormError>{error}</FormError>
        <Field
          label={t.reset.newPassword}
          name="password"
          type="password"
          autoComplete="new-password"
          required
          autoFocus
          minLength={PASSWORD_MIN_LENGTH}
          hint={t.reset.minLength(PASSWORD_MIN_LENGTH)}
          error={errors.password}
        />
        <Field
          label={t.common.repeatPassword}
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          error={errors.confirm}
        />
        <Button type="submit" disabled={pending}>
          {pending ? t.reset.saving : t.reset.change}
        </Button>
      </form>
    </AuthLayout>
  );
}
