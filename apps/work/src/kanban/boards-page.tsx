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
import { LoaderCircleIcon, MailIcon, PlusIcon, SquareKanbanIcon, UsersIcon } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
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
import { TEMPLATE_LABELS } from "./logic";
import { ROLE_LABELS } from "./share-dialog";

/** Lista de tableros (F4-10) y alta con plantilla (F4-03). */
export function BoardsPage(): ReactNode {
  const [creating, setCreating] = useState(false);
  return (
    <WorkLayout>
      {() => (
        <div className="mx-auto grid max-w-5xl gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Tableros</h1>
            <Button onClick={() => setCreating(true)}>
              <PlusIcon aria-hidden="true" />
              Nuevo tablero
            </Button>
          </div>
          <PendingInvitations />
          <BoardList onCreate={() => setCreating(true)} />
          <NewBoardDialog open={creating} onOpenChange={setCreating} />
        </div>
      )}
    </WorkLayout>
  );
}

function BoardList({ onCreate }: { onCreate: () => void }) {
  const boards = useBoards();
  if (boards.isPending) {
    return (
      <p role="status" className="flex items-center gap-2 text-muted-foreground">
        <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
        Cargando tableros…
      </p>
    );
  }
  if (boards.isError) {
    return (
      <div className="flex items-center gap-3">
        <p role="alert">{errorMessage(boards.error)}</p>
        <Button variant="outline" onClick={() => void boards.refetch()}>
          Reintentar
        </Button>
      </div>
    );
  }
  if (boards.data.length === 0) {
    return (
      <section className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-card p-8 text-center">
        <SquareKanbanIcon aria-hidden="true" className="size-10 text-primary" />
        <h2 className="text-lg font-semibold">Aún no tienes tableros</h2>
        <p className="max-w-md text-muted-foreground">
          Empieza con una plantilla: Personal para el día a día, Sprint para un equipo o Proyecto /
          auditoría para trabajos por fases.
        </p>
        <Button onClick={onCreate}>Crear el primero</Button>
      </section>
    );
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {boards.data.map((board) => (
        <li key={board.id}>
          <Link
            to="/tableros/$boardId"
            params={{ boardId: board.id }}
            className="flex h-full flex-col gap-1 rounded-xl border bg-card p-4 shadow-xs transition-colors hover:border-primary/50 hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <span className="font-medium">{board.name}</span>
            <span className="text-sm text-muted-foreground">
              {TEMPLATE_LABELS[board.template].name} ·{" "}
              {board.openCards === 1
                ? "1 tarjeta abierta"
                : `${String(board.openCards)} tarjetas abiertas`}
            </span>
            {board.role !== "owner" ? (
              <span className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                <UsersIcon aria-hidden="true" className="size-3.5" />
                De {board.ownerName ?? "otra persona"} · {ROLE_LABELS[board.role]}
              </span>
            ) : board.members > 0 ? (
              <span className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                <UsersIcon aria-hidden="true" className="size-3.5" />
                {board.members === 1
                  ? "Compartido con 1 persona"
                  : `Compartido con ${String(board.members)} personas`}
              </span>
            ) : null}
          </Link>
        </li>
      ))}
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
    <section aria-labelledby="invitaciones-titulo" className="grid gap-2">
      <h2 id="invitaciones-titulo" className="flex items-center gap-2 text-lg font-semibold">
        <MailIcon aria-hidden="true" className="size-5 text-primary" />
        Te han invitado
      </h2>
      <ul className="grid gap-2">
        {invitations.data.map((invitation) => (
          <li
            key={invitation.id}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 p-3"
          >
            <span className="min-w-0 flex-1 text-sm">
              <span className="font-medium">{invitation.boardName}</span>
              <span className="block text-muted-foreground">
                {invitation.invitedBy ?? "Alguien"} te invita · {ROLE_LABELS[invitation.role]}
              </span>
            </span>
            <span className="flex gap-2">
              <Button
                size="sm"
                disabled={answer.isPending}
                onClick={() => answer.mutate({ id: invitation.id, accept: true })}
                aria-label={`Aceptar la invitación a ${invitation.boardName}`}
              >
                Aceptar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={answer.isPending}
                onClick={() => answer.mutate({ id: invitation.id, accept: false })}
                aria-label={`Rechazar la invitación a ${invitation.boardName}`}
              >
                Rechazar
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
            <DialogTitle>Nuevo tablero</DialogTitle>
            <DialogDescription>
              Elige una plantilla; luego puedes cambiar las columnas.
            </DialogDescription>
          </DialogHeader>
          <Field
            label="Nombre"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={KANBAN_LIMITS.boardName}
            required
            autoFocus
          />
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Plantilla</legend>
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
                  <span className="text-sm font-medium">{TEMPLATE_LABELS[value].name}</span>
                  <span className="text-sm text-muted-foreground">
                    {TEMPLATE_LABELS[value].description}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <FormError>{create.isError ? errorMessage(create.error) : null}</FormError>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending || name.trim() === ""}>
              {create.isPending ? "Creando…" : "Crear tablero"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
