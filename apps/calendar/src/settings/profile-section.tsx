import {
  changePasswordRequestSchema,
  localeSchema,
  nameSchema,
  PASSWORD_MIN_LENGTH,
  timeZoneSchema,
} from "@delyra/shared";
import {
  type ActiveSession,
  apiFetch,
  Button,
  errorMessage,
  Field,
  FormError,
  ME_QUERY_KEY,
  SelectField,
  setLocale,
  toast,
} from "@delyra/ui";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { apiFieldErrors, type FieldErrors, formValues } from "../auth/form";
import { LOCALE_OPTIONS, timeZoneOptions, weekStartOptions } from "./format";
import { settingsMessages } from "./messages";
import { Section } from "./section";

/** Nombre, zona horaria, idioma e inicio de semana. */
export function ProfileSection({ session }: { session: ActiveSession }) {
  const queryClient = useQueryClient();
  const { user, settings } = session;
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const t = settingsMessages().profile;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const values = formValues(event.currentTarget);
    const found: FieldErrors = {};
    const name = nameSchema.safeParse(values.name);
    if (!name.success) found.name = name.error.issues[0]?.message;
    const timeZone = timeZoneSchema.safeParse(values.timeZone);
    if (!timeZone.success) found.timeZone = timeZone.error.issues[0]?.message;
    const locale = localeSchema.safeParse(values.locale);
    if (!locale.success) found.locale = t.invalidLocale;
    setErrors(found);
    if (!name.success || !timeZone.success || !locale.success) return;

    const next = {
      timeZone: timeZone.data,
      locale: locale.data,
      weekStart: Number(values.weekStart),
    };
    setPending(true);
    try {
      if (name.data !== user.name) {
        await apiFetch("/api/me/profile", { method: "PATCH", body: { name: name.data } });
      }
      if (
        next.timeZone !== settings.timeZone ||
        next.locale !== settings.locale ||
        next.weekStart !== settings.weekStart
      ) {
        await apiFetch("/api/me/settings", { method: "PATCH", body: next });
      }
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      // F7-06: el idioma nuevo se aplica al momento (la página se vuelve a pintar).
      await setLocale(next.locale);
      toast.success(settingsMessages().profile.saved);
    } catch (error) {
      setErrors(apiFieldErrors(error));
      setFormError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Section id="perfil" title={t.title} description={t.description}>
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="grid max-w-md gap-4">
        <FormError>{formError}</FormError>
        <Field
          label={t.name}
          name="name"
          autoComplete="name"
          defaultValue={user.name}
          maxLength={80}
          required
          error={errors.name}
        />
        <Field
          label={settingsMessages().common.email}
          name="email-readonly"
          type="email"
          value={user.email}
          readOnly
          disabled
          hint={t.emailHint}
        />
        <SelectField
          label={t.timeZone}
          name="timeZone"
          defaultValue={settings.timeZone}
          options={timeZoneOptions(settings.timeZone)}
          error={errors.timeZone}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label={t.language}
            name="locale"
            defaultValue={settings.locale}
            options={LOCALE_OPTIONS}
            hint={t.languageHint}
            error={errors.locale}
          />
          <SelectField
            label={t.weekStart}
            name="weekStart"
            defaultValue={String(settings.weekStart)}
            options={weekStartOptions()}
          />
        </div>
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? t.saving : t.save}
          </Button>
        </div>
      </form>
    </Section>
  );
}

/** Cambio de contraseña: pide la actual y cierra las demás sesiones. */
export function PasswordSection() {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const queryClient = useQueryClient();
  const t = settingsMessages().password;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const form = event.currentTarget;
    const values = formValues(form);
    const parsed = changePasswordRequestSchema.safeParse(values);
    const found: FieldErrors = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) found[String(issue.path[0])] ??= issue.message;
    } else if (values.newPassword !== values.confirm) {
      found.confirm = t.dontMatch;
    }
    setErrors(found);
    if (!parsed.success || Object.keys(found).length > 0) return;

    setPending(true);
    try {
      await apiFetch("/api/me/password", { method: "POST", body: parsed.data });
      form.reset();
      await queryClient.invalidateQueries({ queryKey: ["account"] });
      toast.success(t.changed);
    } catch (error) {
      setErrors(apiFieldErrors(error));
      setFormError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Section id="contrasena" title={t.title} description={t.description}>
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="grid max-w-md gap-4">
        <FormError>{formError}</FormError>
        <Field
          label={t.current}
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          error={errors.currentPassword}
        />
        <Field
          label={t.new}
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          hint={t.minLength(PASSWORD_MIN_LENGTH)}
          error={errors.newPassword}
        />
        <Field
          label={t.repeat}
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          error={errors.confirm}
        />
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? t.changing : t.change}
          </Button>
        </div>
      </form>
    </Section>
  );
}
