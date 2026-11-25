import { Button, errorMessage, Field, FormError } from "@delyra/ui";
import { type FormEvent, useState } from "react";
import { formValues } from "../auth/form";
import { settingsMessages } from "./messages";

/** Formulario común: contraseña y código actual (TOTP o de recuperación). */
export function ReauthForm({
  submitLabel,
  onSubmit,
  destructive = false,
}: {
  submitLabel: string;
  onSubmit: (values: { password: string; code: string }) => Promise<void>;
  /** Botón rojo, para acciones que no se pueden deshacer (eliminar la cuenta). */
  destructive?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const t = settingsMessages();

  async function handle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = formValues(event.currentTarget);
    const password = values.password ?? "";
    const code = (values.code ?? "").replace(/\s+/g, "");
    if (!password || code.length < 6) {
      setError(t.twoFactor.reauthMissing);
      return;
    }
    setError(null);
    setPending(true);
    try {
      await onSubmit({ password, code });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <form noValidate onSubmit={(event) => void handle(event)} className="grid gap-4">
      <FormError>{error}</FormError>
      <Field
        label={t.common.password}
        name="password"
        type="password"
        autoComplete="current-password"
        required
        autoFocus
      />
      <Field
        label={t.twoFactor.currentCode}
        name="code"
        autoComplete="one-time-code"
        hint={t.twoFactor.currentCodeHint}
        maxLength={11}
        required
      />
      <Button type="submit" disabled={pending} variant={destructive ? "destructive" : "default"}>
        {pending ? t.common.checking : submitLabel}
      </Button>
    </form>
  );
}
