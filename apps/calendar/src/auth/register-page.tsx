import {
  invitationInfoResponseSchema,
  nameSchema,
  PASSWORD_MIN_LENGTH,
  passwordSchema,
} from "@delyra/shared";
import {
  apiFetch,
  AuthLayout,
  Button,
  errorMessage,
  Field,
  FormError,
  FullPageSpinner,
  ME_QUERY_KEY,
} from "@delyra/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { apiFieldErrors, type FieldErrors, formValues, useFragmentToken } from "./form";
import { useTurnstile } from "./use-turnstile";
import { authMessages } from "./messages";

function validateRegistration(values: Record<string, string>): FieldErrors {
  const errors: FieldErrors = {};
  const name = nameSchema.safeParse(values.name);
  if (!name.success) errors.name = name.error.issues[0]?.message;
  const password = passwordSchema.safeParse(values.password);
  if (!password.success) errors.password = password.error.issues[0]?.message;
  else if (values.password !== values.confirm) {
    errors.confirm = authMessages().common.passwordsDontMatch;
  }
  return errors;
}

/** Alta desde un enlace de invitación (`/registro#token=…`). */
export function RegisterPage() {
  const token = useFragmentToken();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const turnstile = useTurnstile("register");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const t = authMessages();

  const invitation = useQuery({
    queryKey: ["auth", "invitation", token],
    enabled: token !== null,
    retry: false,
    staleTime: Infinity,
    queryFn: ({ signal }) =>
      apiFetch("/api/auth/invitation", {
        method: "POST",
        body: { token },
        schema: invitationInfoResponseSchema,
        signal,
      }),
  });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const values = formValues(event.currentTarget);
    const found = validateRegistration(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    if (!turnstile.token) {
      setFormError(t.common.completeTurnstile);
      return;
    }
    setPending(true);
    try {
      await apiFetch("/api/auth/register", {
        method: "POST",
        body: {
          token,
          name: values.name,
          password: values.password,
          turnstileToken: turnstile.token,
        },
      });
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      await navigate({ to: "/configurar-2fa", search: { next: undefined } });
    } catch (error) {
      setErrors(apiFieldErrors(error));
      setFormError(errorMessage(error));
      turnstile.reset();
    } finally {
      setPending(false);
    }
  }

  if (!token || invitation.isError) {
    return (
      <AuthLayout title={t.register.invalidTitle} description={t.register.invalidDescription}>
        <span />
      </AuthLayout>
    );
  }
  if (!invitation.data) return <FullPageSpinner />;

  return (
    <AuthLayout
      title={t.register.title}
      description={
        <>
          {t.register.invitedAs} <strong>{invitation.data.email}</strong>. {t.register.afterwards}
        </>
      }
    >
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="grid gap-4">
        <FormError>{formError}</FormError>
        {/* Para que el gestor de contraseñas asocie la contraseña al email correcto. */}
        <input
          type="email"
          name="username"
          autoComplete="username"
          value={invitation.data.email}
          readOnly
          hidden
        />
        <Field
          label={t.register.name}
          name="name"
          autoComplete="name"
          required
          autoFocus
          maxLength={80}
          error={errors.name}
        />
        <Field
          label={t.common.password}
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          hint={t.register.passwordHint(PASSWORD_MIN_LENGTH)}
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
        {turnstile.element}
        <Button type="submit" disabled={pending}>
          {pending ? t.register.creating : t.register.create}
        </Button>
      </form>
    </AuthLayout>
  );
}
