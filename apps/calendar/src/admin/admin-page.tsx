import {
  type AdminInvitation,
  adminInvitationsResponseSchema,
  type AdminUser,
  adminUsersResponseSchema,
  createInvitationRequestSchema,
  invitationDeliveryResponseSchema,
} from "@delyra/shared";
import {
  type ActiveSession,
  apiFetch,
  AppShell,
  Button,
  cn,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  errorMessage,
  Field,
  FormError,
  RequireSession,
  SelectField,
  toast,
  useLogout,
} from "@delyra/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import { CopyIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { apiFieldErrors, type FieldErrors, formValues } from "../auth/form";
import { formatDateTime } from "../settings/format";
import { Section } from "../settings/section";

const USERS_KEY = ["admin", "users"] as const;
const INVITATIONS_KEY = ["admin", "invitations"] as const;

const ROLE_OPTIONS = [
  { value: "member", label: "Miembro" },
  { value: "admin", label: "Administrador" },
] as const;

const ROLE_LABELS: Record<string, string> = { member: "Miembro", admin: "Administrador" };

/** Enlace de invitación recién generado: solo se ve una vez (en D1 solo queda su hash). */
function InvitationLink({
  email,
  link,
  emailed,
}: {
  email: string;
  link: string;
  emailed: boolean;
}) {
  return (
    <div className="grid gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
      <p>
        {emailed
          ? `Hemos enviado la invitación a ${email}. También puedes compartir este enlace:`
          : `El envío de correo no está configurado: comparte tú este enlace con ${email} por un canal privado.`}
      </p>
      <div className="flex gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1.5 font-mono text-xs select-all">
          {link}
        </code>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(link).then(
              () => toast.success("Enlace copiado"),
              () => toast.error("No se pudo copiar"),
            );
          }}
        >
          <CopyIcon aria-hidden="true" />
          Copiar
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Es de un solo uso y no se podrá volver a mostrar. Si se pierde, reenvía la invitación.
      </p>
    </div>
  );
}

function InviteForm() {
  const queryClient = useQueryClient();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<{ email: string; link: string; emailed: boolean } | null>(
    null,
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const form = event.currentTarget;
    const values = formValues(form);
    const parsed = createInvitationRequestSchema.safeParse({
      email: values.email,
      role: values.role,
      expiresInDays: Number(values.expiresInDays),
    });
    if (!parsed.success) {
      const found: FieldErrors = {};
      for (const issue of parsed.error.issues) found[String(issue.path[0])] ??= issue.message;
      setErrors(found);
      return;
    }
    setErrors({});
    setPending(true);
    try {
      const result = await apiFetch("/api/admin/invitations", {
        method: "POST",
        body: parsed.data,
        schema: invitationDeliveryResponseSchema,
      });
      setCreated({ email: parsed.data.email, link: result.link, emailed: result.emailed });
      form.reset();
      await queryClient.invalidateQueries({ queryKey: INVITATIONS_KEY });
    } catch (error) {
      setErrors(apiFieldErrors(error));
      setFormError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-4">
      <form
        noValidate
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem_8rem_auto] sm:items-end"
      >
        <FormError>{formError}</FormError>
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="off"
          required
          error={errors.email}
        />
        <SelectField label="Rol" name="role" defaultValue="member" options={ROLE_OPTIONS} />
        <SelectField
          label="Caduca en"
          name="expiresInDays"
          defaultValue="7"
          options={[
            { value: "1", label: "1 día" },
            { value: "7", label: "7 días" },
            { value: "30", label: "30 días" },
          ]}
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Invitando…" : "Invitar"}
        </Button>
      </form>
      {created ? <InvitationLink {...created} /> : null}
    </div>
  );
}

function invitationStatus(invitation: AdminInvitation): { label: string; open: boolean } {
  if (invitation.acceptedAt) return { label: "Aceptada", open: false };
  if (invitation.revokedAt) return { label: "Revocada", open: false };
  if (Date.parse(invitation.expiresAt) < Date.now()) return { label: "Caducada", open: true };
  return { label: "Pendiente", open: true };
}

function InvitationsList({ timeZone }: { timeZone: string }) {
  const queryClient = useQueryClient();
  const [resent, setResent] = useState<{ email: string; link: string; emailed: boolean } | null>(
    null,
  );
  const invitations = useQuery({
    queryKey: INVITATIONS_KEY,
    queryFn: ({ signal }) =>
      apiFetch("/api/admin/invitations", { schema: adminInvitationsResponseSchema, signal }),
  });
  const resend = useMutation({
    mutationFn: (invitation: AdminInvitation) =>
      apiFetch(`/api/admin/invitations/${invitation.id}/resend`, {
        method: "POST",
        schema: invitationDeliveryResponseSchema,
      }).then((result) => ({ ...result, email: invitation.email })),
    onSuccess: (result) => {
      setResent(result);
      void queryClient.invalidateQueries({ queryKey: INVITATIONS_KEY });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/admin/invitations/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Invitación revocada");
      void queryClient.invalidateQueries({ queryKey: INVITATIONS_KEY });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const list = invitations.data?.invitations ?? [];
  return (
    <div className="grid gap-3">
      {resent ? <InvitationLink {...resent} /> : null}
      {invitations.isError ? <p role="alert">{errorMessage(invitations.error)}</p> : null}
      {list.length === 0 && invitations.isSuccess ? (
        <p className="text-sm text-muted-foreground">Aún no hay invitaciones.</p>
      ) : null}
      <ul className="divide-y rounded-md border text-sm">
        {list.map((invitation) => {
          const status = invitationStatus(invitation);
          return (
            <li key={invitation.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{invitation.email}</p>
                <p className="text-muted-foreground">
                  {ROLE_LABELS[invitation.role]} · {status.label} · creada el{" "}
                  {formatDateTime(invitation.createdAt, timeZone)}
                </p>
              </div>
              {status.open ? (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={resend.isPending}
                    onClick={() => resend.mutate(invitation)}
                  >
                    Reenviar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate(invitation.id)}
                  >
                    Revocar
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

type UserAction = "disable" | "enable" | "reset-2fa";

const ACTION_COPY: Record<UserAction, { title: string; body: string; confirm: string }> = {
  disable: {
    title: "Desactivar la cuenta",
    body: "No podrá entrar y se cerrarán todas sus sesiones. Puedes reactivarla después.",
    confirm: "Desactivar",
  },
  enable: {
    title: "Reactivar la cuenta",
    body: "Podrá volver a entrar con su contraseña y su segundo factor.",
    confirm: "Reactivar",
  },
  "reset-2fa": {
    title: "Reiniciar la verificación en dos pasos",
    body: "Se borran su app autenticadora y sus códigos de recuperación, y se cierran sus sesiones. Al volver a entrar tendrá que configurarla de nuevo. Hazlo solo si has comprobado su identidad por otra vía.",
    confirm: "Reiniciar 2FA",
  },
};

function UsersList({ currentUserId, timeZone }: { currentUserId: string; timeZone: string }) {
  const queryClient = useQueryClient();
  const [pendingAction, setPendingAction] = useState<{
    user: AdminUser;
    action: UserAction;
  } | null>(null);
  const users = useQuery({
    queryKey: USERS_KEY,
    queryFn: ({ signal }) =>
      apiFetch("/api/admin/users", { schema: adminUsersResponseSchema, signal }),
  });
  const act = useMutation({
    mutationFn: ({ user, action }: { user: AdminUser; action: UserAction }) =>
      apiFetch(`/api/admin/users/${user.id}/${action}`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Hecho");
      setPendingAction(null);
      void queryClient.invalidateQueries({ queryKey: USERS_KEY });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const copy = pendingAction ? ACTION_COPY[pendingAction.action] : null;
  return (
    <div className="grid gap-3">
      {users.isError ? <p role="alert">{errorMessage(users.error)}</p> : null}
      <ul className="divide-y rounded-md border text-sm">
        {(users.data?.users ?? []).map((user) => {
          const self = user.id === currentUserId;
          return (
            <li key={user.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {user.name} {self ? <span className="text-muted-foreground">(tú)</span> : null}
                </p>
                <p className="truncate text-muted-foreground">{user.email}</p>
                <p className="mt-1 flex flex-wrap gap-1.5 text-xs">
                  <span className="rounded-full border px-2 py-0.5">{ROLE_LABELS[user.role]}</span>
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5",
                      user.status === "disabled" && "border-destructive/40 text-destructive",
                    )}
                  >
                    {user.status === "active" ? "Activa" : "Desactivada"}
                  </span>
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5",
                      !user.hasTotp && "border-destructive/40 text-destructive",
                    )}
                  >
                    {user.hasTotp ? "2FA activo" : "Sin 2FA"}
                  </span>
                  <span className="px-1 py-0.5 text-muted-foreground">
                    {user.lastLoginAt
                      ? `Último acceso: ${formatDateTime(user.lastLoginAt, timeZone)}`
                      : "Nunca ha entrado"}
                  </span>
                </p>
              </div>
              {self ? null : (
                <div className="flex gap-2">
                  {user.hasTotp ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPendingAction({ user, action: "reset-2fa" })}
                    >
                      Reiniciar 2FA
                    </Button>
                  ) : null}
                  <Button
                    variant={user.status === "active" ? "ghost" : "outline"}
                    size="sm"
                    onClick={() =>
                      setPendingAction({
                        user,
                        action: user.status === "active" ? "disable" : "enable",
                      })
                    }
                  >
                    {user.status === "active" ? "Desactivar" : "Reactivar"}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <Dialog
        open={pendingAction !== null}
        onOpenChange={(open) => !open && setPendingAction(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy?.title}</DialogTitle>
            <DialogDescription>
              {pendingAction ? `${pendingAction.user.name} (${pendingAction.user.email}). ` : null}
              {copy?.body}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancelar</Button>
            </DialogClose>
            <Button
              variant={pendingAction?.action === "enable" ? "default" : "destructive"}
              disabled={act.isPending}
              onClick={() => pendingAction && act.mutate(pendingAction)}
            >
              {copy?.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AdminContent({ session }: { session: ActiveSession }) {
  const timeZone = session.settings.timeZone;
  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Administración</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Todas las acciones quedan registradas en el historial de seguridad.
        </p>
      </div>
      <Section
        id="invitar"
        title="Invitar a alguien"
        description="Solo se puede crear una cuenta con una invitación. El enlace es de un solo uso."
      >
        <InviteForm />
      </Section>
      <Section id="invitaciones" title="Invitaciones">
        <InvitationsList timeZone={timeZone} />
      </Section>
      <Section id="usuarios" title="Usuarios">
        <UsersList currentUserId={session.user.id} timeZone={timeZone} />
      </Section>
    </div>
  );
}

/** Panel mínimo de administración (F1-17). A quien no es admin se le muestra un 404. */
export function AdminPage() {
  const router = useRouter();
  const logout = useLogout();
  return (
    <RequireSession navigate={(path) => router.history.replace(path)}>
      {(session) => (
        <AppShell app="calendar" user={session.user} onSignOut={() => logout.mutate()}>
          {session.user.role === "admin" ? (
            <AdminContent session={session} />
          ) : (
            <div className="mx-auto max-w-md py-16 text-center">
              <h1 className="text-2xl font-semibold tracking-tight">Página no encontrada</h1>
              <p className="mt-2 text-muted-foreground">La dirección no existe o ha cambiado.</p>
              <Button asChild className="mt-6">
                <Link to="/">Ir al inicio</Link>
              </Button>
            </div>
          )}
        </AppShell>
      )}
    </RequireSession>
  );
}
