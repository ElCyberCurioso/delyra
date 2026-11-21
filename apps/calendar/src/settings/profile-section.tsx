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
  toast,
} from "@delyra/ui";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { apiFieldErrors, type FieldErrors, formValues } from "../auth/form";
import { LOCALE_OPTIONS, timeZoneOptions, WEEK_START_OPTIONS } from "./format";
import { Section } from "./section";

/** Nombre, zona horaria, idioma e inicio de semana. */
export function ProfileSection({ session }: { session: ActiveSession }) {
  const queryClient = useQueryClient();
  const { user, settings } = session;
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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
    if (!locale.success) found.locale = "Idioma no válido";
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
      toast.success("Cambios guardados");
    } catch (error) {
      setErrors(apiFieldErrors(error));
      setFormError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Section
      id="perfil"
      title="Perfil y preferencias"
      description="Las fechas y horas de Delyra se muestran en tu zona horaria."
    >
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="grid max-w-md gap-4">
        <FormError>{formError}</FormError>
        <Field
          label="Nombre"
          name="name"
          autoComplete="name"
          defaultValue={user.name}
          maxLength={80}
          required
          error={errors.name}
        />
        <Field
          label="Email"
          name="email-readonly"
          type="email"
          value={user.email}
          readOnly
          disabled
          hint="Para cambiarlo, pide a un administrador una invitación nueva."
        />
        <SelectField
          label="Zona horaria"
          name="timeZone"
          defaultValue={settings.timeZone}
          options={timeZoneOptions(settings.timeZone)}
          error={errors.timeZone}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Idioma"
            name="locale"
            defaultValue={settings.locale}
            options={LOCALE_OPTIONS}
            hint="Se usa en los correos."
            error={errors.locale}
          />
          <SelectField
            label="La semana empieza en"
            name="weekStart"
            defaultValue={String(settings.weekStart)}
            options={WEEK_START_OPTIONS}
          />
        </div>
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Guardando…" : "Guardar cambios"}
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
      found.confirm = "Las contraseñas no coinciden";
    }
    setErrors(found);
    if (!parsed.success || Object.keys(found).length > 0) return;

    setPending(true);
    try {
      await apiFetch("/api/me/password", { method: "POST", body: parsed.data });
      form.reset();
      await queryClient.invalidateQueries({ queryKey: ["account"] });
      toast.success("Contraseña cambiada. Se han cerrado tus otras sesiones.");
    } catch (error) {
      setErrors(apiFieldErrors(error));
      setFormError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Section
      id="contrasena"
      title="Contraseña"
      description="Al cambiarla se cierran tus sesiones en otros dispositivos."
    >
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="grid max-w-md gap-4">
        <FormError>{formError}</FormError>
        <Field
          label="Contraseña actual"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          error={errors.currentPassword}
        />
        <Field
          label="Contraseña nueva"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          hint={`Mínimo ${String(PASSWORD_MIN_LENGTH)} caracteres.`}
          error={errors.newPassword}
        />
        <Field
          label="Repite la contraseña nueva"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          error={errors.confirm}
        />
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Cambiando…" : "Cambiar contraseña"}
          </Button>
        </div>
      </form>
    </Section>
  );
}
