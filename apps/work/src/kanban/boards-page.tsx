import { BOARD_TEMPLATES, type BoardTemplate, KANBAN_LIMITS } from "@delyra/shared";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FormError,
  errorMessage,
  toast,
} from "@delyra/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ClipboardCheckIcon,
  HouseIcon,
  LayoutGridIcon,
  LoaderCircleIcon,
  MailIcon,
  PlusIcon,
  RocketIcon,
  SquareKanbanIcon,
  UsersIcon,
} from "lucide-react";
import { type CSSProperties, type FormEvent, type ReactNode, useState } from "react";
import { WorkLayout } from "../layout";
import {
  acceptBoardInvitation,
  BOARDS_KEY,
  boardKey,
  createBoard,
  declineBoardInvitation,
  INVITATIONS_KEY,
  useBoards,
  usePendingInvitations,
} from "./api";
import { templateLabel } from "./logic";
import { workMessages } from "./messages";

const TEMPLATE_ICONS: Record<BoardTemplate, typeof HouseIcon> = {
  personal: HouseIcon,
  sprint: RocketIcon,
  audit: ClipboardCheckIcon,
  empty: LayoutGridIcon,
};

const order = (i: number) => ({ "--i": i }) as CSSProperties;

/** Lista de tableros (F4-10) y alta con plantilla (F4-03), en mosaicos. */
export function BoardsPage(): ReactNode {
  const [creating, setCreating] = useState(false);
  return (
    <WorkLayout>
      {() => (
        <div className="mx-auto grid max-w-7xl gap-5">
          <Overview onCreate={() => setCreating(true)} />
          <PendingInvitations />
          <BoardList onCreate={() => setCreating(true)} />
          <NewBoardDialog open={creating} onOpenChange={setCreating} />
        </div>
      )}
    </WorkLayout>
  );
}

/** Cabecera en mosaicos: título con acción y tres cifras del conjunto de tableros. */
function Overview({ onCreate }: { onCreate: () => void }) {
  const t = workMessages().boards;
  const boards = useBoards().data ?? [];
  const open = boards.reduce((sum, b) => sum + b.openCards, 0);
  const shared = boards.filter((b) => b.role !== "owner" || b.members > 0).length;
  const stats = [
    { label: t.statBoards, value: boards.length },
    { label: t.statOpen, value: open },
    { label: t.statShared, value: shared },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
      <div
        className="brand-gradient animate-rise relative overflow-hidden rounded-3xl p-6 text-white shadow-[var(--shadow-lift)] sm:col-span-3 lg:col-span-2"
        style={order(0)}
      >
        <div className="pointer-events-none absolute -top-16 -right-10 size-56 rounded-full bg-white/15 blur-2xl" />
        <h1 className="relative text-3xl font-bold tracking-tight">{t.title}</h1>
        <p className="relative mt-1 max-w-sm text-white/85">{t.subtitle}</p>
        <Button
          onClick={onCreate}
          className="relative mt-5 bg-white text-zinc-900 shadow-lg hover:bg-white/90"
        >
          <PlusIcon aria-hidden="true" />
          {t.new}
        </Button>
      </div>
      {stats.map((stat, i) => (
        <div
          key={stat.label}
          className="tile animate-rise flex flex-col justify-between p-5"
          style={order(i + 1)}
        >
          <span className="text-sm font-medium text-muted-foreground">{stat.label}</span>
          <span className="mt-3 text-4xl font-bold tracking-tight tabular-nums">{stat.value}</span>
        </div>
      ))}
    </div>
  );
}

function BoardList({ onCreate }: { onCreate: () => void }) {
  const boards = useBoards();
  const t = workMessages().boards;
  if (boards.isPending) {
    return (
      <p role="status" className="flex items-center gap-2 text-muted-foreground">
        <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
        {t.loading}
      </p>
    );
  }
  if (boards.isError) {
    return (
      <div className="flex items-center gap-3">
        <p role="alert">{errorMessage(boards.error)}</p>
        <Button variant="outline" onClick={() => void boards.refetch()}>
          {t.retry}
        </Button>
      </div>
    );
  }
  if (boards.data.length === 0) {
    return (
      <section className="tile animate-rise flex min-h-64 flex-col items-center justify-center gap-3 border-dashed p-8 text-center">
        <span className="brand-gradient grid size-14 place-items-center rounded-2xl text-white shadow-lg">
          <SquareKanbanIcon aria-hidden="true" className="size-7" />
        </span>
        <h2 className="text-lg font-bold">{t.emptyTitle}</h2>
        <p className="max-w-md text-muted-foreground">{t.emptyBody}</p>
        <Button onClick={onCreate}>{t.createFirst}</Button>
      </section>
    );
  }
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {boards.data.map((board, index) => {
        const Icon = TEMPLATE_ICONS[board.template];
        return (
          <li
            key={board.id}
            className={index === 0 ? "sm:col-span-2 xl:col-span-1 xl:row-span-2" : undefined}
          >
            <Link
              to="/tableros/$boardId"
              params={{ boardId: board.id }}
              className="tile lift animate-rise group flex h-full flex-col gap-4 p-5 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              style={order(index + 4)}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="brand-gradient grid size-11 shrink-0 place-items-center rounded-2xl text-white shadow-md transition-transform duration-300 group-hover:-rotate-6 motion-reduce:transition-none">
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                  {templateLabel(board.template).name}
                </span>
              </div>
              <span className="text-lg leading-snug font-bold tracking-tight">{board.name}</span>
              <span className="mt-auto flex flex-wrap items-end justify-between gap-2">
                <span className="text-sm text-muted-foreground">
                  <span className="block text-3xl font-bold text-foreground tabular-nums">
                    {board.openCards}
                  </span>{" "}
                  {t.openCards(board.openCards).replace(/^\d+\s/, "")}
                </span>
                {board.role !== "owner" ? (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <UsersIcon aria-hidden="true" className="size-3.5" />
                    {t.ownedBy(board.ownerName ?? t.someone, workMessages().roles[board.role])}
                  </span>
                ) : board.members > 0 ? (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <UsersIcon aria-hidden="true" className="size-3.5" />
                    {t.sharedWith(board.members)}
                  </span>
                ) : null}
              </span>
            </Link>
          </li>
        );
      })}
      <li>
        <button
          type="button"
          onClick={onCreate}
          className="press animate-rise flex h-full min-h-40 w-full flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed p-5 text-muted-foreground transition-colors hover:border-primary/50 hover:bg-accent/50 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          style={order(boards.data.length + 4)}
        >
          <PlusIcon aria-hidden="true" className="size-6" />
          <span className="font-semibold">{t.newTile}</span>
        </button>
      </li>
    </ul>
  );
}

/** Invitaciones a tableros de otras personas que esperan respuesta (F7-04). */
function PendingInvitations() {
  const invitations = usePendingInvitations();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const answer = useMutation({
    mutationFn: (v: { id: string; accept: boolean }) =>
      v.accept ? acceptBoardInvitation(v.id) : declineBoardInvitation(v.id),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: INVITATIONS_KEY });
      void queryClient.invalidateQueries({ queryKey: BOARDS_KEY });
      if (result) {
        void navigate({ to: "/tableros/$boardId", params: { boardId: result.boardId } });
      }
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      void queryClient.invalidateQueries({ queryKey: INVITATIONS_KEY });
    },
  });
  if (!invitations.data || invitations.data.length === 0) return null;
  return (
    <section
      aria-labelledby="invitaciones-titulo"
      className="tile animate-rise grid gap-3 border-primary/40 p-5"
    >
      <h2 id="invitaciones-titulo" className="flex items-center gap-2 text-lg font-semibold">
        <MailIcon aria-hidden="true" className="size-5 text-primary" />
        {workMessages().boards.invitedTitle}
      </h2>
      <ul className="grid gap-2">
        {invitations.data.map((invitation) => (
          <li
            key={invitation.id}
            className="flex flex-wrap items-center gap-3 rounded-2xl bg-accent/60 p-3"
          >
            <span className="min-w-0 flex-1 text-sm">
              <span className="font-medium">{invitation.boardName}</span>
              <span className="block text-muted-foreground">
                {workMessages().boards.invites(
                  invitation.invitedBy ?? workMessages().boards.someoneInvites,
                  workMessages().roles[invitation.role],
                )}
              </span>
            </span>
            <span className="flex gap-2">
              <Button
                size="sm"
                disabled={answer.isPending}
                onClick={() => answer.mutate({ id: invitation.id, accept: true })}
                aria-label={workMessages().boards.accept(invitation.boardName)}
              >
                {workMessages().boards.acceptShort}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={answer.isPending}
                onClick={() => answer.mutate({ id: invitation.id, accept: false })}
                aria-label={workMessages().boards.decline(invitation.boardName)}
              >
                {workMessages().boards.declineShort}
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function NewBoardDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<BoardTemplate>("personal");
  const create = useMutation({
    mutationFn: () => createBoard({ name, template }),
    onSuccess: (detail) => {
      queryClient.setQueryData(boardKey(detail.board.id), detail);
      void queryClient.invalidateQueries({ queryKey: BOARDS_KEY });
      onOpenChange(false);
      setName("");
      void navigate({ to: "/tableros/$boardId", params: { boardId: detail.board.id } });
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{workMessages().boards.new}</DialogTitle>
            <DialogDescription>{workMessages().boards.newDescription}</DialogDescription>
          </DialogHeader>
          <Field
            label={workMessages().boards.name}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={KANBAN_LIMITS.boardName}
            required
            autoFocus
          />
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">{workMessages().boards.template}</legend>
            {BOARD_TEMPLATES.map((value) => (
              <label
                key={value}
                className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
              >
                <input
                  type="radio"
                  name="template"
                  value={value}
                  checked={template === value}
                  onChange={() => setTemplate(value)}
                  className="mt-1"
                />
                <span className="grid gap-0.5">
                  <span className="text-sm font-medium">{templateLabel(value).name}</span>
                  <span className="text-sm text-muted-foreground">
                    {templateLabel(value).description}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <FormError>{create.isError ? errorMessage(create.error) : null}</FormError>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending || name.trim() === ""}>
              {create.isPending ? workMessages().boards.creating : workMessages().boards.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
