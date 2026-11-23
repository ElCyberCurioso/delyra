import {
  PASSKEY_NAME_MAX_LENGTH,
  type Passkey,
  passkeysResponseSchema,
  webauthnOptionsResponseSchema,
} from "@delyra/shared";
import {
  apiFetch,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  errorMessage,
  Field,
  FormError,
  toast,
} from "@delyra/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudIcon, FingerprintIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { formValues } from "../auth/form";
import { createPasskeyCredential, passkeyErrorKind, passkeysSupported } from "../auth/passkeys";
import { describeUserAgent, formatDateTime } from "./format";
import { settingsMessages } from "./messages";
import { ReauthForm } from "./reauth-form";

export const PASSKEYS_QUERY_KEY = ["account", "passkeys"] as const;

/** Alta en dos pasos: reautenticación (contraseña y código) y creación en el dispositivo. */
function AddPasskeyDialog({ onClose }: { onClose: () => void }) {
  const [options, setOptions] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const queryClient = useQueryClient();
  const t = settingsMessages();

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!options) return;
    const name = (formValues(event.currentTarget).name ?? "").trim();
    if (!name) {
      setError(t.passkeys.nameMissing);
      return;
    }
    setError(null);
    setPending(true);
    try {
      const response = await createPasskeyCredential(options);
      await apiFetch("/api/me/passkeys", { method: "POST", body: { name, response } });
      toast.success(t.passkeys.added);
      void queryClient.invalidateQueries({ queryKey: ["account"] });
      onClose();
    } catch (caught) {
      const kind = passkeyErrorKind(caught);
      setError(
        kind === "cancelled"
          ? t.passkeys.cancelled
          : kind === "exists"
            ? t.passkeys.exists
            : errorMessage(caught),
      );
      // El reto es de un solo uso: para reintentar hace falta otro.
      if (kind === null) setOptions(null);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.passkeys.addTitle}</DialogTitle>
          <DialogDescription>
            {options ? t.passkeys.addName : t.twoFactor.changeAppConfirm}
          </DialogDescription>
        </DialogHeader>
        {options ? (
          <form noValidate onSubmit={(event) => void create(event)} className="grid gap-4">
            <FormError>{error}</FormError>
            <Field
              label={t.passkeys.name}
              name="name"
              defaultValue={describeUserAgent(navigator.userAgent)}
              maxLength={PASSKEY_NAME_MAX_LENGTH}
              hint={t.passkeys.nameHint}
              autoComplete="off"
              required
              autoFocus
            />
            <Button type="submit" disabled={pending}>
              <FingerprintIcon aria-hidden="true" />
              {pending ? t.passkeys.waiting : t.passkeys.create}
            </Button>
          </form>
        ) : (
          <ReauthForm
            submitLabel={t.common.continue}
            onSubmit={async (body) => {
              const result = await apiFetch("/api/me/passkeys/options", {
                method: "POST",
                body,
                schema: webauthnOptionsResponseSchema,
              });
              setError(null);
              setOptions(result.options);
            }}
          />
        )}
        {!options && error ? <FormError>{error}</FormError> : null}
      </DialogContent>
    </Dialog>
  );
}

function RemovePasskeyDialog({ passkey, onClose }: { passkey: Passkey; onClose: () => void }) {
  const queryClient = useQueryClient();
  const t = settingsMessages();
  const remove = useMutation({
    mutationFn: () => apiFetch(`/api/me/passkeys/${passkey.id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success(t.passkeys.removed);
      void queryClient.invalidateQueries({ queryKey: ["account"] });
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.passkeys.removeTitle}</DialogTitle>
          <DialogDescription>{t.passkeys.removeBody(passkey.name)}</DialogDescription>
        </DialogHeader>
        <FormError>{remove.error ? errorMessage(remove.error) : null}</FormError>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
            {t.passkeys.remove}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Llaves de acceso (F7-09): alternativa al código al iniciar sesión. */
export function PasskeysPanel({ timeZone }: { timeZone: string }) {
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Passkey | null>(null);
  const t = settingsMessages();
  const list = useQuery({
    queryKey: PASSKEYS_QUERY_KEY,
    queryFn: ({ signal }) =>
      apiFetch("/api/me/passkeys", { schema: passkeysResponseSchema, signal }),
  });
  const supported = passkeysSupported();
  const passkeys = list.data?.passkeys ?? [];

  return (
    <section className="grid gap-3 rounded-2xl border p-4" aria-labelledby="llaves-titulo">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="llaves-titulo" className="flex items-center gap-2 font-semibold">
            <FingerprintIcon aria-hidden="true" className="size-4" />
            {t.passkeys.title}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{t.passkeys.intro}</p>
        </div>
        <Button variant="outline" disabled={!supported} onClick={() => setAdding(true)}>
          <PlusIcon aria-hidden="true" />
          {t.passkeys.add}
        </Button>
      </div>
      {!supported ? (
        <p className="text-sm text-muted-foreground">{t.passkeys.unsupported}</p>
      ) : null}
      {list.isPending ? (
        <p className="text-sm text-muted-foreground">{t.common.loading}</p>
      ) : passkeys.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.passkeys.none}</p>
      ) : (
        <ul className="grid gap-2">
          {passkeys.map((passkey) => (
            <li
              key={passkey.id}
              className="animate-pop flex flex-wrap items-center gap-3 rounded-xl bg-muted/50 p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-medium break-words">
                  {passkey.name}
                  {passkey.backedUp ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-card px-2 py-0.5 text-xs font-normal text-muted-foreground">
                      <CloudIcon aria-hidden="true" className="size-3" />
                      {t.passkeys.synced}
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t.passkeys.createdAt(formatDateTime(passkey.createdAt, timeZone))}
                  {" · "}
                  {passkey.lastUsedAt
                    ? t.passkeys.lastUsed(formatDateTime(passkey.lastUsedAt, timeZone))
                    : t.passkeys.neverUsed}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t.passkeys.removeLabel(passkey.name)}
                onClick={() => setRemoving(passkey)}
              >
                <Trash2Icon aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {adding ? <AddPasskeyDialog onClose={() => setAdding(false)} /> : null}
      {removing ? (
        <RemovePasskeyDialog passkey={removing} onClose={() => setRemoving(null)} />
      ) : null}
    </section>
  );
}
