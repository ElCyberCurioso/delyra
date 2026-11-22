import {
  type BoardColumn,
  type BoardDetail,
  CARD_PRIORITIES,
  KANBAN_LIMITS,
  LABEL_COLORS,
} from "@delyra/shared";
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  errorMessage,
  Field,
  FormError,
  Input,
  toast,
} from "@delyra/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  DownloadIcon,
  FilterXIcon,
  LoaderCircleIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
  XIcon,
} from "lucide-react";
import { type FormEvent, useEffect, useId, useMemo, useState } from "react";
import { WorkLayout } from "../layout";
import type { BoardSearch } from "../router";
import {
  addColumn,
  addLabel,
  applyCard,
  archiveCard,
  archivedKey,
  BOARDS_KEY,
  boardKey,
  createCard,
  deleteBoard,
  deleteColumn,
  deleteLabel,
  moveCard,
  moveColumn,
  updateBoard,
  updateColumn,
  useArchived,
  useBoard,
} from "./api";
import { BoardCanvas } from "./board-canvas";
import { CardDialog } from "./card-dialog";
import {
  type BoardFilters,
  hasFilters,
  matchesFilters,
  moveCardLocally,
  moveColumnLocally,
  PRIORITY_LABELS,
} from "./logic";

/** Tablero (F4-08 a F4-10). */
export interface BoardPageProps {
  boardId: string;
  search: BoardSearch;
  setSearch: (patch: Partial<BoardSearch>) => void;
}

export function BoardPage(props: BoardPageProps) {
  return (
    <WorkLayout>
      {(session) => <Board {...props} timeZone={session.settings.timeZone} />}
    </WorkLayout>
  );
}

function Board({ boardId, search, setSearch, timeZone }: BoardPageProps & { timeZone: string }) {
  const board = useBoard(boardId);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  if (board.isPending) {
    return (
      <p role="status" className="flex items-center gap-2 text-muted-foreground">
        <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
        Cargando tablero…
      </p>
    );
  }
  if (board.isError) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Tablero no disponible</h1>
        <p className="text-muted-foreground">{errorMessage(board.error)}</p>
        <Button asChild>
          <Link to="/">Volver a mis tableros</Link>
        </Button>
      </div>
    );
  }
  return (
    <BoardView
      board={board.data}
      search={search}
      setSearch={setSearch}
      timeZone={timeZone}
      now={now}
    />
  );
}

function toFilters(search: BoardSearch): BoardFilters {
  return {
    q: search.q,
    label: search.etiqueta,
    priority: search.prioridad,
    due: search.vence === "vencidas" ? "overdue" : search.vence === "semana" ? "week" : undefined,
  };
}

function BoardView({
  board,
  search,
  setSearch,
  timeZone,
  now,
}: {
  board: BoardDetail;
  search: BoardSearch;
  setSearch: (patch: Partial<BoardSearch>) => void;
  timeZone: string;
  now: number;
}) {
  const queryClient = useQueryClient();
  const key = boardKey(board.board.id);
  const filters = useMemo(() => toFilters(search), [search]);
  const visible = useMemo(
    () =>
      new Set(
        board.cards.filter((c) => matchesFilters(c, filters, now, timeZone)).map((c) => c.id),
      ),
    [board.cards, filters, now, timeZone],
  );
  const filtered = hasFilters(filters);
  const [editingColumn, setEditingColumn] = useState<BoardColumn | "new" | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);

  /** Cambio optimista con vuelta atrás si la API falla (F4-08). */
  async function optimistic(change: (current: BoardDetail) => BoardDetail) {
    await queryClient.cancelQueries({ queryKey: key });
    const previous = queryClient.getQueryData<BoardDetail>(key);
    if (previous) queryClient.setQueryData(key, change(previous));
    return { previous };
  }
  const rollback = (context: { previous?: BoardDetail } | undefined) => {
    if (context?.previous) queryClient.setQueryData(key, context.previous);
  };

  const moveCardMutation = useMutation({
    mutationFn: (v: { cardId: string; columnId: string; index: number }) =>
      moveCard(v.cardId, v.columnId, v.index),
    onMutate: (v) => optimistic((b) => moveCardLocally(b, v.cardId, v.columnId, v.index)),
    onError: (error, _v, context) => {
      rollback(context);
      toast.error(`No se pudo mover la tarjeta: ${errorMessage(error)}`);
    },
    onSuccess: ({ card, wipExceeded }) => {
      applyCard(queryClient, card);
      if (wipExceeded) {
        const column = board.columns.find((c) => c.id === card.columnId);
        toast.warning(
          `«${column?.name ?? ""}» supera su límite WIP (${String(column?.wipLimit ?? "")}).`,
        );
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  const moveColumnMutation = useMutation({
    mutationFn: (v: { columnId: string; index: number }) => moveColumn(v.columnId, v.index),
    onMutate: (v) => optimistic((b) => moveColumnLocally(b, v.columnId, v.index)),
    onError: (error, _v, context) => {
      rollback(context);
      toast.error(`No se pudo mover la columna: ${errorMessage(error)}`);
    },
    onSuccess: (detail) => queryClient.setQueryData(key, detail),
  });

  const addCardMutation = useMutation({
    mutationFn: (v: { columnId: string; title: string }) => createCard(v.columnId, v.title),
    onSuccess: (card) => applyCard(queryClient, card),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const visibleCount = visible.size;
  return (
    // `minmax(0,1fr)`: el tablero se desplaza dentro de su caja, no estira la página.
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
        <div className="flex min-w-0 flex-1 basis-64 items-center gap-1">
          <Button asChild variant="ghost" size="icon" aria-label="Volver a mis tableros">
            <Link to="/">
              <ArrowLeftIcon aria-hidden="true" />
            </Link>
          </Button>
          <h1 className="min-w-0 truncate text-xl font-semibold tracking-tight sm:text-2xl">
            {board.board.name}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditingColumn("new")}>
            <PlusIcon aria-hidden="true" />
            Columna
          </Button>
          <Button variant="outline" size="sm" onClick={() => setArchivedOpen(true)}>
            <ArchiveIcon aria-hidden="true" />
            Archivadas
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
            <SettingsIcon aria-hidden="true" />
            Ajustes
          </Button>
          {/* F6-02: el tablero en CSV (hoja de cálculo) o JSON. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <DownloadIcon aria-hidden="true" />
                Exportar
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <a href={`/api/boards/${board.board.id}/export?format=csv`} download>
                  Hoja de cálculo (.csv)
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={`/api/boards/${board.board.id}/export?format=json`} download>
                  Datos completos (.json)
                </a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Toolbar board={board} search={search} setSearch={setSearch} />
      {filtered ? (
        <p role="status" className="text-sm text-muted-foreground">
          {visibleCount === 1 ? "1 tarjeta coincide" : `${String(visibleCount)} tarjetas coinciden`}{" "}
          con los filtros.
        </p>
      ) : null}

      {board.columns.length === 0 ? (
        <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-8 text-center">
          <p className="text-muted-foreground">Este tablero aún no tiene columnas.</p>
          <Button onClick={() => setEditingColumn("new")}>Añadir la primera columna</Button>
        </div>
      ) : (
        <BoardCanvas
          board={board}
          visible={visible}
          timeZone={timeZone}
          now={now}
          onOpenCard={(id) => setSearch({ tarjeta: id })}
          onMoveCard={(cardId, columnId, index) =>
            moveCardMutation.mutate({ cardId, columnId, index })
          }
          onMoveColumn={(columnId, index) => moveColumnMutation.mutate({ columnId, index })}
          onAddCard={(columnId, title) => addCardMutation.mutateAsync({ columnId, title })}
          onEditColumn={setEditingColumn}
        />
      )}

      <CardDialog
        cardId={search.tarjeta ?? null}
        board={board}
        timeZone={timeZone}
        now={now}
        onClose={() => setSearch({ tarjeta: undefined })}
      />
      <ColumnDialog board={board} column={editingColumn} onClose={() => setEditingColumn(null)} />
      <BoardSettingsDialog board={board} open={settingsOpen} onOpenChange={setSettingsOpen} />
      <ArchivedDialog
        board={board}
        open={archivedOpen}
        onOpenChange={setArchivedOpen}
        onOpenCard={(id) => {
          setArchivedOpen(false);
          setSearch({ tarjeta: id });
        }}
      />
    </div>
  );
}

const SELECT =
  "h-10 w-full rounded-md border bg-background px-2 text-base sm:h-9 sm:w-auto sm:text-sm";

function Toolbar({
  board,
  search,
  setSearch,
}: {
  board: BoardDetail;
  search: BoardSearch;
  setSearch: (patch: Partial<BoardSearch>) => void;
}) {
  const [q, setQ] = useState(search.q ?? "");
  // En móvil los desplegables se pliegan tras el botón «Filtros».
  const [open, setOpen] = useState(false);
  const panelId = useId();
  // La búsqueda se aplica al dejar de escribir.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if ((search.q ?? "") !== q) setSearch({ q: q || undefined });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [q, search.q, setSearch]);
  const any = hasFilters(toFilters(search));
  const active = [search.etiqueta, search.prioridad, search.vence].filter(Boolean).length;
  return (
    <search
      className="grid gap-2 sm:flex sm:flex-wrap sm:items-center"
      aria-label="Filtros del tablero"
    >
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Buscar tarjetas"
            placeholder="Buscar tarjetas…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-10 pl-8 sm:h-9"
          />
        </div>
        <Button
          variant="outline"
          className="h-10 sm:hidden"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
        >
          <SlidersHorizontalIcon aria-hidden="true" />
          Filtros{active > 0 ? ` (${String(active)})` : ""}
        </Button>
      </div>
      <div
        id={panelId}
        className={cn("grid gap-2 sm:flex sm:flex-wrap sm:items-center", !open && "max-sm:hidden")}
      >
        <select
          aria-label="Filtrar por etiqueta"
          className={SELECT}
          value={search.etiqueta ?? ""}
          onChange={(e) => setSearch({ etiqueta: e.target.value || undefined })}
        >
          <option value="">Todas las etiquetas</option>
          {board.labels.map((label) => (
            <option key={label.id} value={label.id}>
              {label.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filtrar por prioridad"
          className={SELECT}
          value={search.prioridad ?? ""}
          onChange={(e) =>
            setSearch({
              prioridad: CARD_PRIORITIES.find((p) => p === e.target.value),
            })
          }
        >
          <option value="">Cualquier prioridad</option>
          {CARD_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
        <select
          aria-label="Filtrar por fecha límite"
          className={SELECT}
          value={search.vence ?? ""}
          onChange={(e) =>
            setSearch({
              vence:
                e.target.value === "vencidas" || e.target.value === "semana"
                  ? e.target.value
                  : undefined,
            })
          }
        >
          <option value="">Cualquier fecha</option>
          <option value="vencidas">Vencidas</option>
          <option value="semana">Esta semana</option>
        </select>
        {any ? (
          <Button
            variant="ghost"
            size="sm"
            className="max-sm:h-10 max-sm:justify-start"
            onClick={() => {
              setQ("");
              setSearch({
                q: undefined,
                etiqueta: undefined,
                prioridad: undefined,
                vence: undefined,
              });
            }}
          >
            <FilterXIcon aria-hidden="true" />
            Quitar filtros
          </Button>
        ) : null}
      </div>
    </search>
  );
}

function ColumnDialog({
  board,
  column,
  onClose,
}: {
  board: BoardDetail;
  column: BoardColumn | "new" | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={column !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {column !== null ? (
          <ColumnForm board={board} editing={column === "new" ? null : column} onClose={onClose} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Se monta al abrir el diálogo: el estado inicial sale de la columna, sin efectos. */
function ColumnForm({
  board,
  editing,
  onClose,
}: {
  board: BoardDetail;
  editing: BoardColumn | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(editing?.name ?? "");
  const [wip, setWip] = useState(
    editing?.wipLimit !== null && editing?.wipLimit !== undefined ? String(editing.wipLimit) : "",
  );
  const [isDone, setIsDone] = useState(editing?.isDone ?? false);
  const key = boardKey(board.board.id);
  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), wipLimit: wip ? Number(wip) : null, isDone };
      return editing ? updateColumn(editing.id, body) : addColumn(board.board.id, body);
    },
    onSuccess: (detail) => {
      queryClient.setQueryData(key, detail);
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteColumn(editing?.id ?? ""),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: BOARDS_KEY });
      onClose();
      toast.success("Columna borrada");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const cards = editing ? board.cards.filter((c) => c.columnId === editing.id).length : 0;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };
  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{editing ? "Ajustes de la columna" : "Nueva columna"}</DialogTitle>
        <DialogDescription>
          El límite WIP avisa cuando la columna tiene más tarjetas de las que conviene.
        </DialogDescription>
      </DialogHeader>
      <Field
        label="Nombre"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={KANBAN_LIMITS.columnName}
        required
        autoFocus
      />
      <Field
        label="Límite WIP"
        type="number"
        min={1}
        max={999}
        value={wip}
        onChange={(e) => setWip(e.target.value)}
        hint="Déjalo vacío si no quieres límite."
      />
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={isDone}
          onChange={(e) => setIsDone(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          Columna de terminadas
          <span className="block text-muted-foreground">
            Las tarjetas que entran se marcan como hechas y se archivan solas pasado un tiempo.
          </span>
        </span>
      </label>
      <FormError>{save.isError ? errorMessage(save.error) : null}</FormError>
      <DialogFooter className="sm:justify-between">
        {editing ? (
          <Button
            type="button"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            disabled={remove.isPending}
            onClick={() => {
              const warning =
                cards > 0
                  ? `¿Borrar «${editing.name}» y sus ${String(cards)} tarjetas? No se puede deshacer.`
                  : `¿Borrar «${editing.name}»?`;
              if (window.confirm(warning)) remove.mutate();
            }}
          >
            Borrar columna
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" disabled={save.isPending || !name.trim()}>
          {editing ? "Guardar" : "Añadir columna"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function BoardSettingsDialog({
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
        {open ? <BoardSettings board={board} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

/** Se monta al abrir el diálogo: el estado inicial sale del tablero, sin efectos. */
function BoardSettings({ board, onClose }: { board: BoardDetail; onClose: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState(board.board.name);
  const [days, setDays] = useState(String(board.board.autoarchiveDays));
  const [labelName, setLabelName] = useState("");
  const [labelColor, setLabelColor] = useState<string>(LABEL_COLORS[0]);
  const key = boardKey(board.board.id);
  const save = useMutation({
    mutationFn: () =>
      updateBoard(board.board.id, { name: name.trim(), autoarchiveDays: Number(days) || 0 }),
    onSuccess: (detail) => {
      queryClient.setQueryData(key, detail);
      void queryClient.invalidateQueries({ queryKey: BOARDS_KEY });
      onClose();
      toast.success("Tablero guardado");
    },
  });
  const label = useMutation({
    mutationFn: () => addLabel(board.board.id, { name: labelName.trim(), color: labelColor }),
    onSuccess: () => {
      setLabelName("");
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const removeLabel = useMutation({
    mutationFn: (id: string) => deleteLabel(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: () => deleteBoard(board.board.id),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: BOARDS_KEY });
      toast.success("Tablero borrado");
      void navigate({ to: "/" });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <>
      <DialogHeader>
        <DialogTitle>Ajustes del tablero</DialogTitle>
        <DialogDescription>Nombre, autoarchivado y etiquetas.</DialogDescription>
      </DialogHeader>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field
          label="Nombre"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={KANBAN_LIMITS.boardName}
          required
        />
        <Field
          label="Archivar las terminadas tras (días)"
          type="number"
          min={0}
          max={365}
          value={days}
          onChange={(e) => setDays(e.target.value)}
          hint="0 = no archivar nunca. Se revisa cada noche."
        />
        <FormError>{save.isError ? errorMessage(save.error) : null}</FormError>
        <Button
          type="submit"
          className="justify-self-end"
          disabled={save.isPending || !name.trim()}
        >
          Guardar
        </Button>
      </form>

      <section className="grid gap-2 border-t pt-4" aria-labelledby="etiquetas-titulo">
        <h3 id="etiquetas-titulo" className="text-sm font-semibold">
          Etiquetas
        </h3>
        <ul className="flex flex-wrap gap-1.5">
          {board.labels.map((l) => (
            <li
              key={l.id}
              className="inline-flex items-center gap-1 rounded-full border py-0.5 pr-1 pl-2 text-sm"
            >
              <span
                aria-hidden="true"
                className="size-2.5 rounded-full"
                style={{ backgroundColor: l.color }}
              />
              {l.name}
              <button
                type="button"
                aria-label={`Borrar la etiqueta ${l.name}`}
                className="rounded-full p-0.5 hover:bg-accent pointer-coarse:p-1.5"
                onClick={() => {
                  if (
                    window.confirm(`¿Borrar la etiqueta «${l.name}»? Se quitará de sus tarjetas.`)
                  )
                    removeLabel.mutate(l.id);
                }}
              >
                <XIcon aria-hidden="true" className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (labelName.trim()) label.mutate();
          }}
        >
          <Input
            aria-label="Nombre de la nueva etiqueta"
            placeholder="Nueva etiqueta"
            value={labelName}
            onChange={(e) => setLabelName(e.target.value)}
            maxLength={KANBAN_LIMITS.labelName}
            className="w-44"
          />
          <fieldset className="flex gap-1">
            <legend className="sr-only">Color</legend>
            {LABEL_COLORS.map((color) => (
              <label key={color} className="cursor-pointer">
                <input
                  type="radio"
                  name="label-color"
                  value={color}
                  checked={labelColor === color}
                  onChange={() => setLabelColor(color)}
                  className="peer sr-only"
                />
                <span
                  className="block size-6 rounded-full ring-offset-2 ring-offset-background peer-checked:ring-2 peer-checked:ring-ring peer-focus-visible:ring-2 peer-focus-visible:ring-ring"
                  style={{ backgroundColor: color }}
                />
                <span className="sr-only">{color}</span>
              </label>
            ))}
          </fieldset>
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={!labelName.trim() || label.isPending}
          >
            Añadir
          </Button>
        </form>
      </section>

      <section className="grid gap-2 border-t pt-4">
        <h3 className="text-sm font-semibold text-destructive">Zona peligrosa</h3>
        <Button
          variant="destructive"
          className="justify-self-start"
          disabled={remove.isPending}
          onClick={() => {
            if (
              window.confirm(
                `¿Borrar «${board.board.name}» con todas sus tarjetas y adjuntos? No se puede deshacer.`,
              )
            )
              remove.mutate();
          }}
        >
          Borrar tablero
        </Button>
      </section>
    </>
  );
}

function ArchivedDialog({
  board,
  open,
  onOpenChange,
  onOpenCard,
}: {
  board: BoardDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenCard: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const archived = useArchived(board.board.id, open);
  const restore = useMutation({
    mutationFn: (id: string) => archiveCard(id, false),
    onSuccess: (card) => {
      applyCard(queryClient, card);
      void queryClient.invalidateQueries({ queryKey: archivedKey(board.board.id) });
      toast.success(`«${card.title}» vuelve al tablero`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const columnName = (id: string) => board.columns.find((c) => c.id === id)?.name ?? "";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Tarjetas archivadas</DialogTitle>
          <DialogDescription>Restaura una tarjeta para devolverla a su columna.</DialogDescription>
        </DialogHeader>
        {archived.isPending ? (
          <p role="status" className="text-muted-foreground">
            Cargando…
          </p>
        ) : archived.isError ? (
          <p role="alert">{errorMessage(archived.error)}</p>
        ) : archived.data.length === 0 ? (
          <p className="text-muted-foreground">No hay tarjetas archivadas.</p>
        ) : (
          <ul className="grid gap-2">
            {archived.data.map((card) => (
              <li key={card.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left hover:underline"
                  onClick={() => onOpenCard(card.id)}
                >
                  {card.title}
                  <span className="block text-xs text-muted-foreground">
                    {columnName(card.columnId)}
                  </span>
                </button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={restore.isPending}
                  onClick={() => restore.mutate(card.id)}
                >
                  Restaurar
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
