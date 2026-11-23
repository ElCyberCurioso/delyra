import {
  BOARD_MEMBER_ROLES,
  BOARD_SHARING_LIMITS,
  type BoardDetail,
  type BoardMemberRole,
  type BoardMembers,
  type BoardRole,
} from "@delyra/shared";
import {
  ApiError,
  Button,
  intlLocale,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  errorMessage,
  Field,
  FormError,
  toast,
} from "@delyra/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { LogOutIcon, UserPlusIcon, XIcon } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import {
  BOARDS_KEY,
  boardKey,
  inviteToBoard,
  membersKey,
  removeBoardMember,
  revokeBoardInvitation,
  setBoardMemberRole,
  useBoardMembers,
} from "./api";
import { workMessages } from "./messages";

/** Compartir un tablero (F7-04): miembros, invitaciones por email y salir del tablero. */

/** Nombre de un papel en el tablero, en el idioma actual. */
export const roleLabel = (role: BoardRole): string => workMessages().roles[role];

const SELECT = "h-9 rounded-md border bg-background px-2 text-base sm:text-sm";

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat(intlLocale(), { dateStyle: "medium" }).format(new Date(iso));

export function ShareDialog({
  board,
  open,
  onOpenChange,
}: {
  board: BoardDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        {open ? <Share board={board} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Share({ board }: { board: BoardDetail }) {
  const boardId = board.board.id;
  const isOwner = board.board.role === "owner";
  const members = useBoardMembers(boardId, true);
  const t = workMessages().share;
  return (
    <>
      <DialogHeader>
        <DialogTitle>{isOwner ? t.shareTitle : t.peopleTitle}</DialogTitle>
        <DialogDescription>
          {isOwner
            ? t.ownerIntro
            : t.memberIntro(board.board.ownerName ?? t.someone, board.board.role === "editor")}
        </DialogDescription>
      </DialogHeader>
      {isOwner ? <InviteForm boardId={boardId} /> : null}
      {members.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t.loading}
        </p>
      ) : members.isError ? (
        <p role="alert" className="text-sm">
          {errorMessage(members.error)}
        </p>
      ) : (
        <MemberList boardId={boardId} data={members.data} />
      )}
    </>
  );
}

/**
 * Tras cualquier cambio: la lista del diálogo y los contadores del tablero. Una petición de la
 * lista que ya estuviera en curso se cancela: su respuesta, anterior al cambio, lo pisaría.
 */
function useApplyMembers(boardId: string) {
  const queryClient = useQueryClient();
  return async (data?: BoardMembers) => {
    const key = membersKey(boardId);
    if (data) {
      await queryClient.cancelQueries({ queryKey: key, exact: true });
      queryClient.setQueryData(key, data);
    } else void queryClient.invalidateQueries({ queryKey: key, exact: true });
    void queryClient.invalidateQueries({ queryKey: boardKey(boardId), exact: true });
    void queryClient.invalidateQueries({ queryKey: BOARDS_KEY });
  };
}

function InviteForm({ boardId }: { boardId: string }) {
  const apply = useApplyMembers(boardId);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<BoardMemberRole>("editor");
  const roleId = useId();
  const invite = useMutation({
    mutationFn: () => inviteToBoard(boardId, { email: email.trim(), role }),
    onSuccess: (data) => {
      void apply(data);
      setEmail("");
      toast.success(workMessages().share.invited);
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    invite.mutate();
  };
  const t = workMessages().share;
  const fieldError =
    invite.error instanceof ApiError ? invite.error.fieldError("email") : undefined;
  return (
    <form onSubmit={submit} className="grid gap-3 rounded-lg border p-3">
      <Field
        label={t.email}
        type="email"
        autoComplete="off"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={fieldError}
        required
      />
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1.5">
          <label htmlFor={roleId} className="text-sm font-medium">
            {t.permission}
          </label>
          <select
            id={roleId}
            className={SELECT}
            value={role}
            onChange={(e) => setRole(e.target.value === "reader" ? "reader" : "editor")}
          >
            {BOARD_MEMBER_ROLES.map((value) => (
              <option key={value} value={value}>
                {roleLabel(value)}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={invite.isPending || !email.trim()} className="ml-auto">
          <UserPlusIcon aria-hidden="true" />
          {t.invite}
        </Button>
      </div>
      <FormError>{invite.isError && !fieldError ? errorMessage(invite.error) : null}</FormError>
      <p className="text-xs text-muted-foreground">
        {t.limits(BOARD_SHARING_LIMITS.members, BOARD_SHARING_LIMITS.invitationDays)}
      </p>
    </form>
  );
}

function MemberList({ boardId, data }: { boardId: string; data: BoardMembers }) {
  const apply = useApplyMembers(boardId);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isOwner = data.role === "owner";
  const t = workMessages().share;
  const changeRole = useMutation({
    mutationFn: (v: { userId: string; role: BoardMemberRole }) =>
      setBoardMemberRole(boardId, v.userId, v.role),
    onSuccess: (result) => apply(result),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: (v: { userId: string; self: boolean }) => removeBoardMember(boardId, v.userId),
    onSuccess: (_result, v) => {
      if (v.self) {
        queryClient.removeQueries({ queryKey: boardKey(boardId) });
        void queryClient.invalidateQueries({ queryKey: BOARDS_KEY });
        toast.success(t.left);
        void navigate({ to: "/" });
        return;
      }
      void apply();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const revoke = useMutation({
    mutationFn: (invitationId: string) => revokeBoardInvitation(boardId, invitationId),
    onSuccess: () => apply(),
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div className="grid gap-4">
      <section aria-labelledby="miembros-titulo" className="grid gap-2">
        <h3 id="miembros-titulo" className="text-sm font-semibold">
          {t.withAccess}
        </h3>
        <ul className="grid gap-2">
          {data.members.map((member) => (
            <li
              key={member.userId}
              className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm"
            >
              <span className="min-w-0 flex-1">
                <span className="font-medium">{member.name}</span>
                {member.you ? <span className="text-muted-foreground">{t.you}</span> : null}
                {member.email ? (
                  <span className="block truncate text-xs text-muted-foreground">
                    {member.email}
                  </span>
                ) : null}
              </span>
              {isOwner && member.role !== "owner" ? (
                <>
                  <select
                    aria-label={t.permissionOf(member.name)}
                    className={SELECT}
                    value={member.role}
                    disabled={changeRole.isPending}
                    onChange={(e) =>
                      changeRole.mutate({
                        userId: member.userId,
                        role: e.target.value === "reader" ? "reader" : "editor",
                      })
                    }
                  >
                    {BOARD_MEMBER_ROLES.map((value) => (
                      <option key={value} value={value}>
                        {roleLabel(value)}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-9"
                    aria-label={t.remove(member.name)}
                    disabled={remove.isPending}
                    onClick={() => {
                      if (window.confirm(t.confirmRemove(member.name)))
                        remove.mutate({ userId: member.userId, self: false });
                    }}
                  >
                    <XIcon aria-hidden="true" />
                  </Button>
                </>
              ) : (
                <span className="text-xs text-muted-foreground">{roleLabel(member.role)}</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {isOwner && data.invitations.length > 0 ? (
        <section aria-labelledby="invitaciones-titulo" className="grid gap-2">
          <h3 id="invitaciones-titulo" className="text-sm font-semibold">
            {t.pending}
          </h3>
          <ul className="grid gap-2">
            {data.invitations.map((invitation) => (
              <li
                key={invitation.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-2 text-sm"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{invitation.email}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t.expires(roleLabel(invitation.role), formatDate(invitation.expiresAt))}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(invitation.id)}
                  aria-label={t.revoke(invitation.email)}
                >
                  {t.revokeShort}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!isOwner ? (
        <Button
          variant="outline"
          className="justify-self-start text-destructive hover:text-destructive"
          disabled={remove.isPending}
          onClick={() => {
            const you = data.members.find((m) => m.you);
            if (you && window.confirm(t.confirmLeave))
              remove.mutate({ userId: you.userId, self: true });
          }}
        >
          <LogOutIcon aria-hidden="true" />
          {t.leave}
        </Button>
      ) : null}
    </div>
  );
}
