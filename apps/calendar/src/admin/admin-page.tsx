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
  formatDateTime,
  FormError,
  HealthStatus,
  SelectField,
  toast,
} from "@delyra/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CopyIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { apiFieldErrors, type FieldErrors, formValues } from "../auth/form";
import { CalendarLayout } from "../layout";
import { settingsMessages } from "../settings/messages";
import { Section } from "../settings/section";
import { SystemBackupsSection } from "./system-backups";

const USERS_KEY = ["admin", "users"] as const;
const INVITATIONS_KEY = ["admin", "invitations"] as const;

const roleLabel = (role: "member" | "admin") => settingsMessages().admin.roles[role];

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
  const t = settingsMessages();
  return (
    <div className="grid gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
      <p>{emailed ? t.admin.emailed(email) : t.admin.notEmailed(email)}</p>
      <div className="flex gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1.5 font-mono text-xs select-all">
          {link}
        </code>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(link).then(
              () => toast.success(t.admin.linkCopied),
              () => toast.error(t.admin.copyFailed),
            );
          }}
        >
          <CopyIcon aria-hidden="true" />
          {t.common.copy}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t.admin.oneUse}</p>
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
  const t = settingsMessages();

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
          label={t.common.email}
          name="email"
          type="email"
          autoComplete="off"
          required
          error={errors.email}
        />
        <SelectField
          label={t.admin.role}
          name="role"
          defaultValue="member"
          options={(["member", "admin"] as const).map((role) => ({
            value: role,
            label: roleLabel(role),
          }))}
        />
        <SelectField
          label={t.admin.expiresIn}
          name="expiresInDays"
          defaultValue="7"
          options={[1, 7, 30].map((n) => ({ value: String(n), label: t.admin.days(n) }))}
        />
        <Button type="submit" disabled={pending}>
          {pending ? t.admin.inviting : t.admin.invite}
        </Button>
      </form>
      {created ? <InvitationLink {...created} /> : null}
    </div>
  );
}

function invitationStatus(invitation: AdminInvitation): { label: string; open: boolean } {
  const t = settingsMessages().admin.status;
  if (invitation.acceptedAt) return { label: t.accepted, open: false };
  if (invitation.revokedAt) return { label: t.revoked, open: false };
  if (Date.parse(invitation.expiresAt) < Date.now()) return { label: t.expired, open: true };
  return { label: t.pending, open: true };
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
      toast.success(settingsMessages().admin.revoked);
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
        <p className="text-sm text-muted-foreground">{settingsMessages().admin.noInvitations}</p>
      ) : null}
      <ul className="divide-y rounded-md border text-sm">
        {list.map((invitation) => {
          const status = invitationStatus(invitation);
          return (
            <li key={invitation.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{invitation.email}</p>
                <p className="text-muted-foreground">
                  {roleLabel(invitation.role)} · {status.label} ·{" "}
                  {settingsMessages().admin.createdOn(
                    formatDateTime(invitation.createdAt, timeZone),
                  )}
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
                    {settingsMessages().admin.resend}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate(invitation.id)}
                  >
                    {settingsMessages().admin.revoke}
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

function actionCopy(action: UserAction) {
  const t = settingsMessages().admin.actions;
  return action === "reset-2fa" ? t.reset2fa : t[action];
}

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
      toast.success(settingsMessages().admin.done);
      setPendingAction(null);
      void queryClient.invalidateQueries({ queryKey: USERS_KEY });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const copy = pendingAction ? actionCopy(pendingAction.action) : null;
  const t = settingsMessages();
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
                  {user.name}{" "}
                  {self ? <span className="text-muted-foreground">{t.common.you}</span> : null}
                </p>
                <p className="truncate text-muted-foreground">{user.email}</p>
                <p className="mt-1 flex flex-wrap gap-1.5 text-xs">
                  <span className="rounded-full border px-2 py-0.5">{roleLabel(user.role)}</span>
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5",
                      user.status === "disabled" && "border-destructive/40 text-destructive",
                    )}
                  >
                    {user.status === "active" ? t.admin.active : t.admin.disabled}
                  </span>
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5",
                      !user.hasTotp && "border-destructive/40 text-destructive",
                    )}
                  >
                    {user.hasTotp ? t.admin.has2fa : t.admin.no2fa}
                  </span>
                  <span className="px-1 py-0.5 text-muted-foreground">
                    {user.lastLoginAt
                      ? t.admin.lastLogin(formatDateTime(user.lastLoginAt, timeZone))
                      : t.admin.neverLogged}
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
                      {t.admin.actions.reset2fa.confirm}
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
                    {user.status === "active"
                      ? t.admin.actions.disable.confirm
                      : t.admin.actions.enable.confirm}
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
              <Button variant="outline">{t.common.cancel}</Button>
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
  const t = settingsMessages().admin;
  return (
    <div className="mx-auto grid max-w-6xl items-start gap-5 xl:grid-cols-2 xl:[&>#invitar]:col-span-2 xl:[&>#usuarios]:col-span-2 xl:[&>div:first-child]:col-span-2 [&>:nth-child(2)]:[--i:1] [&>:nth-child(3)]:[--i:2] [&>:nth-child(4)]:[--i:3] [&>:nth-child(5)]:[--i:4] [&>:nth-child(6)]:[--i:5] [&>:nth-child(7)]:[--i:6] [&>:nth-child(8)]:[--i:7]">
      <div>
        <h1 className="animate-rise text-3xl font-bold tracking-tight">{t.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.intro}</p>
      </div>
      <Section id="invitar" title={t.inviteTitle} description={t.inviteDescription}>
        <InviteForm />
      </Section>
      <Section id="invitaciones" title={t.invitations}>
        <InvitationsList timeZone={timeZone} />
      </Section>
      <Section id="usuarios" title={t.users}>
        <UsersList currentUserId={session.user.id} timeZone={timeZone} />
      </Section>
      <SystemBackupsSection timeZone={timeZone} />
      <HealthStatus />
    </div>
  );
}

/** Panel mínimo de administración (F1-17). A quien no es admin se le muestra un 404. */
export function AdminPage() {
  const t = settingsMessages().admin;
  return (
    <CalendarLayout>
      {(session) =>
        session.user.role === "admin" ? (
          <AdminContent session={session} />
        ) : (
          <div className="mx-auto max-w-md py-16 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">{t.notFound}</h1>
            <p className="mt-2 text-muted-foreground">{t.notFoundBody}</p>
            <Button asChild className="mt-6">
              <Link to="/">{t.home}</Link>
            </Button>
          </div>
        )
      }
    </CalendarLayout>
  );
}
