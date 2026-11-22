import {
  ATTACHMENT_TYPES,
  type BoardDetail,
  CARD_PRIORITIES,
  type CardDetail,
  type CardPriority,
  KANBAN_LIMITS,
} from "@delyra/shared";
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  errorMessage,
  Input,
  toast,
} from "@delyra/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  DownloadIcon,
  LoaderCircleIcon,
  PaperclipIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { type FormEvent, type ReactNode, useId, useRef, useState } from "react";
import {
  addChecklistItem,
  addComment,
  applyCard,
  archiveCard,
  archivedKey,
  attachmentUrl,
  BOARDS_KEY,
  boardKey,
  deleteAttachment,
  deleteCard,
  deleteChecklistItem,
  deleteComment,
  moveCard,
  updateCard,
  updateChecklistItem,
  updateComment,
  uploadAttachment,
  useCard,
} from "./api";
import { fromLocalInput, isOverdue, PRIORITY_LABELS, sortedColumns, toLocalInput } from "./logic";
import { Markdown } from "./markdown";

/** Detalle de tarjeta (F4-05, F4-06, F4-07, F4-09). Se abre con `?tarjeta=<id>`. */

export interface CardDialogProps {
  cardId: string | null;
  board: BoardDetail;
  timeZone: string;
  now: number;
  onClose: () => void;
}

export function CardDialog({ cardId, board, timeZone, now, onClose }: CardDialogProps) {
  const card = useCard(cardId);
  return (
    <Dialog open={cardId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[min(48rem,calc(100%-2rem))]">
        {card.data?.boardId === board.board.id ? (
          <CardBody
            card={card.data}
            board={board}
            timeZone={timeZone}
            now={now}
            onClose={onClose}
          />
        ) : (
          <DialogHeader>
            <DialogTitle>
              {card.isError ? "Tarjeta no disponible" : "Cargando tarjeta…"}
            </DialogTitle>
            <DialogDescription>
              {card.isError ? "No existe, se ha borrado o no es tuya." : "Un momento, por favor."}
            </DialogDescription>
          </DialogHeader>
        )}
      </DialogContent>
    </Dialog>
  );
}

const TIMED_REMINDERS = [
  { value: "", label: "Sin aviso" },
  { value: "0", label: "A la hora" },
  { value: "15", label: "15 minutos antes" },
  { value: "60", label: "1 hora antes" },
  { value: "1440", label: "1 día antes" },
];
const ALL_DAY_REMINDERS = [
  { value: "", label: "Sin aviso" },
  { value: "-540", label: "Ese día a las 9:00" },
  { value: "900", label: "El día antes a las 9:00" },
];

const str = (value: unknown) => (typeof value === "string" ? value : "");

const ACTIVITY: Record<string, (data: Record<string, unknown>) => string> = {
  created: (d) => `Creada en «${str(d.column)}»`,
  moved: (d) => `Movida de «${str(d.from)}» a «${str(d.to)}»`,
  completed: () => "Terminada",
  reopened: () => "Reabierta",
  renamed: (d) => `Título cambiado a «${str(d.to)}»`,
  described: () => "Descripción editada",
  priority: (d) => `Prioridad: ${PRIORITY_LABELS[d.to as CardPriority] ?? str(d.to)}`,
  due: (d) => (d.to ? "Fecha límite cambiada" : "Fecha límite quitada"),
  labels: () => "Etiquetas cambiadas",
  archived: () => "Archivada",
  restored: () => "Restaurada",
  autoarchived: () => "Archivada automáticamente",
  commented: () => "Comentario añadido",
  attached: (d) => `Adjunto «${str(d.filename)}» añadido`,
  detached: (d) => `Adjunto «${str(d.filename)}» quitado`,
};

const formatDateTime = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short", timeZone }).format(
    new Date(iso),
  );

const formatSize = (bytes: number) =>
  bytes < 1024
    ? `${String(bytes)} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(0)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function Section({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} id={id} className="grid gap-2">
      <h3 id={headingId} className="text-sm font-semibold">
        {title}
      </h3>
      {children}
    </section>
  );
}

function CardBody({
  card,
  board,
  timeZone,
  now,
  onClose,
}: {
  card: CardDetail;
  board: BoardDetail;
  timeZone: string;
  now: number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const columns = sortedColumns(board);
  const ids = { column: useId(), priority: useId(), due: useId(), reminder: useId() };

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => updateCard(card.id, body),
    onSuccess: (updated) => applyCard(queryClient, updated),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const run = useMutation({
    mutationFn: (action: () => Promise<CardDetail>) => action(),
    onSuccess: (updated) => applyCard(queryClient, updated),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const move = useMutation({
    mutationFn: (columnId: string) => moveCard(card.id, columnId, 10_000),
    onSuccess: ({ card: updated, wipExceeded }) => {
      applyCard(queryClient, updated);
      if (wipExceeded) toast.warning("Esa columna supera su límite WIP.");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const archive = useMutation({
    mutationFn: (archived: boolean) => archiveCard(card.id, archived),
    onSuccess: (updated) => {
      applyCard(queryClient, updated);
      void queryClient.invalidateQueries({ queryKey: archivedKey(board.board.id) });
      void queryClient.invalidateQueries({ queryKey: boardKey(board.board.id) });
      toast.success(updated.archivedAt ? "Tarjeta archivada" : "Tarjeta restaurada");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: () => deleteCard(card.id),
    onSuccess: () => {
      onClose();
      void queryClient.invalidateQueries({ queryKey: boardKey(board.board.id) });
      void queryClient.invalidateQueries({ queryKey: archivedKey(board.board.id) });
      void queryClient.invalidateQueries({ queryKey: BOARDS_KEY });
      toast.success("Tarjeta borrada");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const saveTitle = (input: HTMLTextAreaElement) => {
    const next = input.value.trim();
    if (next && next !== card.title) save.mutate({ title: next });
    else input.value = card.title;
  };

  const overdue = isOverdue(card, now, timeZone);
  const reminderOptions = card.due?.allDay ? ALL_DAY_REMINDERS : TIMED_REMINDERS;
  const currentReminder = card.reminders[0] ? String(card.reminders[0].offsetMinutes) : "";

  const setDue = (due: { allDay: boolean; at: string } | null) =>
    save.mutate({ due: due ? { ...due, tz: timeZone } : null });
  // Sin fecha todavía, la casilla solo elige qué selector se muestra.
  const [allDayDraft, setAllDayDraft] = useState(false);
  const allDay = card.due ? card.due.allDay : allDayDraft;

  return (
    <div className="grid gap-5">
      <DialogHeader className="pr-8 text-left">
        <DialogTitle className="sr-only">{card.title}</DialogTitle>
        <label className="sr-only" htmlFor={`${ids.column}-title`}>
          Título
        </label>
        <textarea
          // Sin controlar: se rehace si el título cambia en el servidor.
          key={card.title}
          id={`${ids.column}-title`}
          defaultValue={card.title}
          onBlur={(e) => saveTitle(e.currentTarget)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          maxLength={KANBAN_LIMITS.cardTitle}
          rows={1}
          className="field-sizing-content w-full resize-none rounded-md border border-transparent bg-transparent px-1 text-lg font-semibold hover:border-input focus-visible:border-ring focus-visible:outline-none"
        />
        <DialogDescription>
          En «{columns.find((c) => c.id === card.columnId)?.name ?? ""}»
          {card.completedAt ? ` · terminada el ${formatDateTime(card.completedAt, timeZone)}` : ""}
          {card.archivedAt ? " · archivada" : ""}
        </DialogDescription>
      </DialogHeader>

      {/* Móvil: propiedades, contenido y acciones. Escritorio: contenido a la izquierda. */}
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_14rem] md:grid-rows-[auto_1fr]">
        <aside
          className="grid content-start gap-4 md:col-start-2 md:row-start-1"
          aria-label="Propiedades de la tarjeta"
        >
          <div className="grid gap-1.5">
            <label htmlFor={ids.column} className="text-sm font-medium">
              Columna
            </label>
            <select
              id={ids.column}
              value={card.columnId}
              disabled={Boolean(card.archivedAt) || move.isPending}
              onChange={(e) => move.mutate(e.target.value)}
              className="h-10 rounded-md border bg-background px-2 text-base sm:h-9 sm:text-sm"
            >
              {columns.map((column) => (
                <option key={column.id} value={column.id}>
                  {column.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <label htmlFor={ids.priority} className="text-sm font-medium">
              Prioridad
            </label>
            <select
              id={ids.priority}
              value={card.priority}
              onChange={(e) => save.mutate({ priority: e.target.value })}
              className="h-10 rounded-md border bg-background px-2 text-base sm:h-9 sm:text-sm"
            >
              {CARD_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </div>
          <fieldset className="grid gap-1.5">
            <legend className="mb-1 text-sm font-medium">Etiquetas</legend>
            {board.labels.length === 0 ? (
              <p className="text-sm text-muted-foreground">Este tablero no tiene etiquetas.</p>
            ) : (
              board.labels.map((label) => (
                <label key={label.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="pointer-coarse:size-5"
                    checked={card.labelIds.includes(label.id)}
                    onChange={(e) =>
                      save.mutate({
                        labelIds: e.target.checked
                          ? [...card.labelIds, label.id]
                          : card.labelIds.filter((id) => id !== label.id),
                      })
                    }
                  />
                  <span
                    aria-hidden="true"
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: label.color }}
                  />
                  {label.name}
                </label>
              ))
            )}
          </fieldset>
          <fieldset className="grid gap-1.5">
            <legend className="mb-1 text-sm font-medium">Fecha límite</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="pointer-coarse:size-5"
                checked={allDay}
                onChange={(e) => {
                  if (!card.due) {
                    setAllDayDraft(e.target.checked);
                    return;
                  }
                  const date = card.due.allDay
                    ? card.due.at
                    : toLocalInput(card.due.at, timeZone).slice(0, 10);
                  setDue(
                    e.target.checked
                      ? { allDay: true, at: date }
                      : { allDay: false, at: fromLocalInput(`${date}T09:00`, timeZone) ?? "" },
                  );
                }}
              />
              Todo el día
            </label>
            <label htmlFor={ids.due} className="sr-only">
              Fecha límite
            </label>
            {allDay ? (
              <Input
                id={ids.due}
                type="date"
                value={card.due?.at ?? ""}
                onChange={(e) => {
                  if (e.target.value) setDue({ allDay: true, at: e.target.value });
                }}
              />
            ) : (
              <Input
                id={ids.due}
                type="datetime-local"
                value={card.due ? toLocalInput(card.due.at, timeZone) : ""}
                onChange={(e) => {
                  const at = fromLocalInput(e.target.value, timeZone);
                  if (at) setDue({ allDay: false, at });
                }}
              />
            )}
            {overdue ? <p className="text-sm font-medium text-destructive">Vencida</p> : null}
            {card.due ? (
              <>
                <label htmlFor={ids.reminder} className="mt-1 text-sm font-medium">
                  Aviso por Telegram
                </label>
                <select
                  id={ids.reminder}
                  value={currentReminder}
                  onChange={(e) =>
                    save.mutate({
                      reminders:
                        e.target.value === ""
                          ? []
                          : [{ offsetMinutes: Number(e.target.value), channel: "telegram" }],
                    })
                  }
                  className="h-10 rounded-md border bg-background px-2 text-base sm:h-9 sm:text-sm"
                >
                  {reminderOptions.some((o) => o.value === currentReminder) ? null : (
                    <option value={currentReminder}>Personalizado</option>
                  )}
                  {reminderOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <Button
                  variant="ghost"
                  size="sm"
                  className="justify-start"
                  onClick={() => setDue(null)}
                >
                  <XIcon aria-hidden="true" />
                  Quitar fecha
                </Button>
              </>
            ) : null}
          </fieldset>
        </aside>
        <div className="grid min-w-0 content-start gap-5 md:col-start-1 md:row-span-2 md:row-start-1">
          <Description card={card} onSave={(description) => save.mutate({ description })} />
          <Checklist card={card} run={(action) => run.mutate(action)} />
          <Attachments card={card} timeZone={timeZone} run={(action) => run.mutate(action)} />
          <Comments card={card} timeZone={timeZone} run={(action) => run.mutate(action)} />
          <Section title="Actividad">
            <ol className="grid gap-1 text-sm text-muted-foreground">
              {card.activity.map((entry) => (
                <li key={entry.id} className="flex flex-wrap justify-between gap-x-3">
                  <span>{ACTIVITY[entry.kind]?.(entry.data) ?? entry.kind}</span>
                  <time dateTime={entry.createdAt} className="text-xs">
                    {formatDateTime(entry.createdAt, timeZone)}
                  </time>
                </li>
              ))}
            </ol>
          </Section>
        </div>
        <div className="grid content-start gap-2 border-t pt-4 md:col-start-2 md:row-start-2">
          {card.archivedAt ? (
            <Button
              variant="outline"
              onClick={() => archive.mutate(false)}
              disabled={archive.isPending}
            >
              <ArchiveRestoreIcon aria-hidden="true" />
              Restaurar
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => archive.mutate(true)}
              disabled={archive.isPending}
            >
              <ArchiveIcon aria-hidden="true" />
              Archivar
            </Button>
          )}
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive"
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm(`¿Borrar «${card.title}»? No se puede deshacer.`)) remove.mutate();
            }}
          >
            <Trash2Icon aria-hidden="true" />
            Borrar tarjeta
          </Button>
        </div>
      </div>
    </div>
  );
}

function Description({ card, onSave }: { card: CardDetail; onSave: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [text, setText] = useState(card.description);
  const id = useId();
  const startEditing = () => {
    setText(card.description);
    setTab("write");
    setEditing(true);
  };
  return (
    <Section title="Descripción">
      {editing ? (
        <div className="grid gap-2">
          <div role="tablist" aria-label="Modo de la descripción" className="flex gap-1">
            {(["write", "preview"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                aria-controls={`${id}-${value}`}
                onClick={() => setTab(value)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-sm",
                  tab === value
                    ? "bg-accent font-medium"
                    : "text-muted-foreground hover:bg-accent/60",
                )}
              >
                {value === "write" ? "Escribir" : "Vista previa"}
              </button>
            ))}
          </div>
          {tab === "write" ? (
            <textarea
              id={`${id}-write`}
              role="tabpanel"
              aria-label="Descripción en Markdown"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={KANBAN_LIMITS.description}
              rows={8}
              className="w-full rounded-md border bg-background p-2 font-mono text-base sm:text-sm"
              autoFocus
            />
          ) : (
            <div id={`${id}-preview`} role="tabpanel" className="min-h-24 rounded-md border p-3">
              <Markdown source={text} className="markdown text-sm" />
            </div>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                onSave(text);
                setEditing(false);
              }}
            >
              Guardar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
            <span className="ml-auto self-center text-xs text-muted-foreground">
              Admite Markdown
            </span>
          </div>
        </div>
      ) : card.description ? (
        <div className="grid gap-2">
          <Markdown source={card.description} className="markdown text-sm" />
          <Button size="sm" variant="outline" className="justify-self-start" onClick={startEditing}>
            Editar descripción
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          className="justify-start text-muted-foreground"
          onClick={startEditing}
        >
          Añadir una descripción…
        </Button>
      )}
    </Section>
  );
}

type Run = (action: () => Promise<CardDetail>) => void;

function Checklist({ card, run }: { card: CardDetail; run: Run }) {
  const [text, setText] = useState("");
  const { done, total } = card.checklist;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    run(() => addChecklistItem(card.id, text.trim()));
    setText("");
  };
  return (
    <Section title={total > 0 ? `Lista (${String(done)}/${String(total)})` : "Lista"}>
      {total > 0 ? (
        <div
          role="progressbar"
          aria-label="Progreso de la lista"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          className="h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${String((done / total) * 100)}%` }}
          />
        </div>
      ) : null}
      <ul className="grid gap-1">
        {card.checklistItems.map((item) => (
          <li key={item.id} className="group flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="pointer-coarse:size-5"
              id={`check-${item.id}`}
              checked={item.done}
              onChange={(e) => run(() => updateChecklistItem(item.id, { done: e.target.checked }))}
            />
            <label
              htmlFor={`check-${item.id}`}
              className={cn("flex-1", item.done && "text-muted-foreground line-through")}
            >
              {item.text}
            </label>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 opacity-60 group-hover:opacity-100 pointer-coarse:size-10 pointer-coarse:opacity-100"
              aria-label={`Quitar «${item.text}» de la lista`}
              onClick={() => run(() => deleteChecklistItem(item.id))}
            >
              <XIcon aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>
      {total < KANBAN_LIMITS.checklistPerCard ? (
        <form onSubmit={submit} className="flex gap-2">
          <Input
            aria-label="Nuevo elemento de la lista"
            placeholder="Añadir elemento…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={KANBAN_LIMITS.checklistText}
          />
          <Button type="submit" variant="outline" disabled={!text.trim()}>
            Añadir
          </Button>
        </form>
      ) : null}
    </Section>
  );
}

const ACCEPT = ATTACHMENT_TYPES.join(",");

function Attachments({ card, timeZone, run }: { card: CardDetail; timeZone: string; run: Run }) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: (file: File) => uploadAttachment(card.id, file),
    onSuccess: (updated) => {
      applyCard(queryClient, updated);
      toast.success("Adjunto subido");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const pick = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (file.size > KANBAN_LIMITS.attachmentBytes) {
      toast.error("El fichero supera los 10 MB.");
      return;
    }
    upload.mutate(file);
    if (input.current) input.current.value = "";
  };
  const full = card.attachmentList.length >= KANBAN_LIMITS.attachmentsPerCard;
  return (
    <Section title="Adjuntos">
      {card.attachmentList.length > 0 ? (
        <ul className="grid gap-1">
          {card.attachmentList.map((file) => (
            <li
              key={file.id}
              className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm"
            >
              <PaperclipIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <a
                href={attachmentUrl(file.id)}
                download={file.filename}
                className="min-w-0 flex-1 truncate underline-offset-4 hover:underline"
              >
                {file.filename}
              </a>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatSize(file.size)} · {formatDateTime(file.createdAt, timeZone)}
              </span>
              <Button asChild variant="ghost" size="icon" className="size-7 pointer-coarse:size-10">
                <a
                  href={attachmentUrl(file.id)}
                  download={file.filename}
                  aria-label={`Descargar ${file.filename}`}
                >
                  <DownloadIcon aria-hidden="true" />
                </a>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 pointer-coarse:size-10"
                aria-label={`Borrar ${file.filename}`}
                onClick={() => {
                  if (window.confirm(`¿Borrar «${file.filename}»?`))
                    run(() => deleteAttachment(file.id));
                }}
              >
                <Trash2Icon aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-center gap-2">
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          id={`upload-${card.id}`}
          onChange={(e) => pick(e.target.files)}
          disabled={upload.isPending || full}
        />
        <Button
          asChild
          variant="outline"
          size="sm"
          className={cn((upload.isPending || full) && "pointer-events-none opacity-50")}
        >
          <label htmlFor={`upload-${card.id}`} className="cursor-pointer">
            {upload.isPending ? (
              <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
            ) : (
              <PaperclipIcon aria-hidden="true" />
            )}
            {upload.isPending ? "Subiendo…" : "Adjuntar fichero"}
          </label>
        </Button>
        <span className="text-xs text-muted-foreground">
          Imágenes, PDF, texto, CSV, ZIP u Office · hasta 10 MB
        </span>
      </div>
    </Section>
  );
}

function Comments({ card, timeZone, run }: { card: CardDetail; timeZone: string; run: Run }) {
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    run(() => addComment(card.id, text.trim()));
    setText("");
  };
  return (
    <Section title="Comentarios">
      <form onSubmit={submit} className="grid gap-2">
        <textarea
          aria-label="Nuevo comentario"
          placeholder="Escribe un comentario…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={KANBAN_LIMITS.comment}
          rows={2}
          className="w-full rounded-md border bg-background p-2 text-base sm:text-sm"
        />
        <Button type="submit" size="sm" className="justify-self-start" disabled={!text.trim()}>
          Comentar
        </Button>
      </form>
      <ul className="grid gap-2">
        {card.commentList.map((comment) => (
          <li key={comment.id} className="grid gap-1 rounded-md border p-2 text-sm">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <time dateTime={comment.createdAt}>
                {formatDateTime(comment.createdAt, timeZone)}
              </time>
              {comment.updatedAt !== comment.createdAt ? <span>(editado)</span> : null}
              <span className="ml-auto flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2"
                  onClick={() => setEditing({ id: comment.id, text: comment.body })}
                >
                  Editar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-destructive hover:text-destructive"
                  onClick={() => {
                    if (window.confirm("¿Borrar el comentario?"))
                      run(() => deleteComment(comment.id));
                  }}
                >
                  Borrar
                </Button>
              </span>
            </div>
            {editing?.id === comment.id ? (
              <form
                className="grid gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const body = editing.text.trim();
                  if (body) run(() => updateComment(comment.id, body));
                  setEditing(null);
                }}
              >
                <textarea
                  aria-label="Editar comentario"
                  value={editing.text}
                  onChange={(e) => setEditing({ id: comment.id, text: e.target.value })}
                  maxLength={KANBAN_LIMITS.comment}
                  rows={2}
                  className="w-full rounded-md border bg-background p-2 text-base sm:text-sm"
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button type="submit" size="sm">
                    Guardar
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    Cancelar
                  </Button>
                </div>
              </form>
            ) : (
              <p className="whitespace-pre-wrap break-words">{comment.body}</p>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}
