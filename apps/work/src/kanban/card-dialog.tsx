import {
  ATTACHMENT_TYPES,
  type BoardDetail,
  CARD_KINDS,
  CARD_PRIORITIES,
  type CardDetail,
  type CardKind,
  type CardPriority,
  KANBAN_LIMITS,
} from "@delyra/shared";
import {
  Button,
  cn,
  ColorPicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  errorMessage,
  Input,
  intlLocale,
  toast,
} from "@delyra/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowDownIcon,
  ArrowUpIcon,
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
import {
  cardIdsByColumn,
  fromLocalInput,
  isOverdue,
  priorityLabel,
  sortedColumns,
  toLocalInput,
} from "./logic";
import { workMessages } from "./messages";
import { Markdown } from "./markdown";
import { AssigneeDialog, kindLabel, kindOptions } from "./kinds";

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
              {card.isError ? workMessages().card.unavailable : workMessages().card.loading}
            </DialogTitle>
            <DialogDescription>
              {card.isError ? workMessages().card.missing : workMessages().card.wait}
            </DialogDescription>
          </DialogHeader>
        )}
      </DialogContent>
    </Dialog>
  );
}

function timedReminders() {
  const t = workMessages().card;
  return [
    { value: "", label: t.noReminder },
    { value: "0", label: t.atTime },
    { value: "15", label: t.minutes15 },
    { value: "60", label: t.hour1 },
    { value: "1440", label: t.day1 },
  ];
}
function allDayReminders() {
  const t = workMessages().card;
  return [
    { value: "", label: t.noReminder },
    { value: "-540", label: t.sameDay9 },
    { value: "900", label: t.dayBefore9 },
  ];
}

const str = (value: unknown) => (typeof value === "string" ? value : "");

const PRIORITIES = new Set<string>(CARD_PRIORITIES);
const CARD_KIND_SET = new Set<string>(CARD_KINDS);

/** A quién se le ha pasado la tarjeta: se guarda al salir del campo o con Intro (vacío = nadie). */
function AssigneeField({
  value,
  onSave,
}: {
  value: string | null;
  onSave: (assignee: string | null) => void;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const id = useId();
  const t = workMessages().card;
  const commit = () => {
    const next = draft.trim();
    if (next !== (value ?? "")) onSave(next === "" ? null : next);
  };
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {t.assignee}
      </label>
      <input
        id={id}
        value={draft}
        maxLength={KANBAN_LIMITS.assignee}
        placeholder={t.assigneePlaceholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        className="h-10 rounded-md border bg-background px-2 text-base sm:h-9 sm:text-sm"
      />
    </div>
  );
}

/** Una entrada del historial de la tarjeta en el idioma actual. */
function describeActivity(kind: string, d: Record<string, unknown>): string {
  const t = workMessages().card.activity;
  switch (kind) {
    case "created":
      return t.created(str(d.column));
    case "moved":
      return t.moved(str(d.from), str(d.to));
    case "completed":
      return t.completed;
    case "reopened":
      return t.reopened;
    case "renamed":
      return t.renamed(str(d.to));
    case "described":
      return t.described;
    case "kind":
      return t.kind(CARD_KIND_SET.has(str(d.to)) ? kindLabel(str(d.to) as CardKind) : str(d.to));
    case "assigned":
      return d.to ? t.assigned(str(d.to)) : t.unassigned;
    case "priority":
      return t.priority(
        PRIORITIES.has(str(d.to)) ? priorityLabel(str(d.to) as CardPriority) : str(d.to),
      );
    case "due":
      return d.to ? t.dueChanged : t.dueRemoved;
    case "labels":
      return t.labels;
    case "archived":
      return t.archived;
    case "restored":
      return t.restored;
    case "autoarchived":
      return t.autoarchived;
    case "commented":
      return t.commented;
    case "attached":
      return t.attached(str(d.filename));
    case "detached":
      return t.detached(str(d.filename));
    default:
      return kind;
  }
}

const formatDateTime = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat(intlLocale(), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(iso));

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
  const ids = {
    column: useId(),
    kind: useId(),
    priority: useId(),
    due: useId(),
    reminder: useId(),
  };
  // F7-04: permisos en el tablero y autoría (solo se muestra si el tablero está compartido).
  const { role } = board.board;
  const readOnly = role === "reader";
  const isOwner = role === "owner";
  const shared = board.board.members > 0 || !isOwner;

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
  const [askAssignee, setAskAssignee] = useState<string | null>(null);
  const move = useMutation({
    mutationFn: (v: string | { columnId: string; index: number; assignee?: string }) =>
      typeof v === "string"
        ? moveCard(card.id, v, 10_000)
        : moveCard(card.id, v.columnId, v.index, v.assignee),
    onSuccess: ({ card: updated, wipExceeded }) => {
      applyCard(queryClient, updated);
      if (wipExceeded) toast.warning(workMessages().card.wipWarning);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const archive = useMutation({
    mutationFn: (archived: boolean) => archiveCard(card.id, archived),
    onSuccess: (updated) => {
      applyCard(queryClient, updated);
      void queryClient.invalidateQueries({ queryKey: archivedKey(board.board.id) });
      void queryClient.invalidateQueries({ queryKey: boardKey(board.board.id) });
      toast.success(
        updated.archivedAt ? workMessages().card.archivedToast : workMessages().card.restoredToast,
      );
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
      toast.success(workMessages().card.deleted);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const saveTitle = (input: HTMLTextAreaElement) => {
    const next = input.value.trim();
    if (next && next !== card.title) save.mutate({ title: next });
    else input.value = card.title;
  };

  const overdue = isOverdue(card, now, timeZone);
  const reminderOptions = card.due?.allDay ? allDayReminders() : timedReminders();
  const siblings = cardIdsByColumn(board)[card.columnId] ?? [];
  const index = siblings.indexOf(card.id);
  const t = workMessages().card;
  const currentReminder = card.reminders[0] ? String(card.reminders[0].offsetMinutes) : "";

  const setDue = (due: { allDay: boolean; at: string } | null) =>
    save.mutate({ due: due ? { ...due, tz: timeZone } : null });
  // Sin fecha todavía, la casilla solo elige qué selector se muestra.
  const [allDayDraft, setAllDayDraft] = useState(false);
  const allDay = card.due ? card.due.allDay : allDayDraft;

  const askColumn = askAssignee ? columns.find((c) => c.id === askAssignee) : null;

  return (
    <div className="grid gap-5">
      <AssigneeDialog
        key={askAssignee ?? "cerrado"}
        request={
          askColumn
            ? { cardTitle: card.title, columnName: askColumn.name, current: card.assignee }
            : null
        }
        onCancel={() => setAskAssignee(null)}
        onConfirm={(assignee) => {
          if (askColumn) move.mutate({ columnId: askColumn.id, index: 10_000, assignee });
          setAskAssignee(null);
        }}
      />
      <DialogHeader className="pr-8 text-left">
        <DialogTitle className="sr-only">{card.title}</DialogTitle>
        <label className="sr-only" htmlFor={`${ids.column}-title`}>
          {t.title}
        </label>
        <textarea
          // Sin controlar: se rehace si el título cambia en el servidor.
          key={card.title}
          id={`${ids.column}-title`}
          defaultValue={card.title}
          readOnly={readOnly}
          onBlur={(e) => {
            if (!readOnly) saveTitle(e.currentTarget);
          }}
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
          {t.inColumn(columns.find((c) => c.id === card.columnId)?.name ?? "")}
          {card.completedAt ? t.completedOn(formatDateTime(card.completedAt, timeZone)) : ""}
          {card.archivedAt ? t.archivedSuffix : ""}
        </DialogDescription>
      </DialogHeader>

      {/* Móvil: propiedades, contenido y acciones. Escritorio: contenido a la izquierda. */}
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_14rem] md:grid-rows-[auto_1fr]">
        <aside
          className="grid content-start gap-4 md:col-start-2 md:row-start-1"
          aria-label={t.properties}
        >
          {/* Desactiva de una vez todos los controles para quien solo lee. */}
          <fieldset disabled={readOnly} className="contents">
            <div className="grid gap-1.5">
              <label htmlFor={ids.column} className="text-sm font-medium">
                {t.column}
              </label>
              <select
                id={ids.column}
                value={card.columnId}
                disabled={Boolean(card.archivedAt) || move.isPending}
                onChange={(e) => {
                  const target = columns.find((c) => c.id === e.target.value);
                  // A una columna delegada: antes, a quién se le pasa.
                  if (target?.delegated) setAskAssignee(target.id);
                  else move.mutate(e.target.value);
                }}
                className="h-10 rounded-md border bg-background px-2 text-base sm:h-9 sm:text-sm"
              >
                {columns.map((column) => (
                  <option key={column.id} value={column.id}>
                    {column.name}
                  </option>
                ))}
              </select>

              {siblings.length > 1 && !card.archivedAt ? (
                <div role="group" aria-label={t.order} className="mt-1 flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={index <= 0 || move.isPending}
                    onClick={() => move.mutate({ columnId: card.columnId, index: index - 1 })}
                  >
                    <ArrowUpIcon aria-hidden="true" />
                    {t.moveUp}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={index >= siblings.length - 1 || move.isPending}
                    onClick={() => move.mutate({ columnId: card.columnId, index: index + 1 })}
                  >
                    <ArrowDownIcon aria-hidden="true" />
                    {t.moveDown}
                  </Button>
                </div>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <label htmlFor={ids.kind} className="text-sm font-medium">
                {t.kind}
              </label>
              <select
                id={ids.kind}
                value={card.kind}
                onChange={(e) => save.mutate({ kind: e.target.value })}
                className="h-10 rounded-md border bg-background px-2 text-base sm:h-9 sm:text-sm"
              >
                {kindOptions().map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <AssigneeField
              key={card.assignee ?? ""}
              value={card.assignee}
              onSave={(assignee) => save.mutate({ assignee })}
            />
            <div className="grid gap-1.5">
              <label htmlFor={ids.priority} className="text-sm font-medium">
                {t.priority}
              </label>
              <select
                id={ids.priority}
                value={card.priority}
                onChange={(e) => save.mutate({ priority: e.target.value })}
                className="h-10 rounded-md border bg-background px-2 text-base sm:h-9 sm:text-sm"
              >
                {CARD_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {priorityLabel(p)}
                  </option>
                ))}
              </select>
            </div>
            <ColorPicker
              legend={t.color}
              value={card.color}
              allowNone
              onChange={(color) => save.mutate({ color })}
            />
            <fieldset className="grid gap-1.5">
              <legend className="mb-1 text-sm font-medium">{t.labels}</legend>
              {board.labels.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t.noLabels}</p>
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
              <legend className="mb-1 text-sm font-medium">{t.due}</legend>
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
                {t.allDay}
              </label>
              <label htmlFor={ids.due} className="sr-only">
                {t.due}
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
              {overdue ? <p className="text-sm font-medium text-destructive">{t.overdue}</p> : null}
              {card.due ? (
                <>
                  {/* Los avisos le llegan a quien creó el tablero: solo esa persona los elige. */}
                  {isOwner ? (
                    <>
                      <label htmlFor={ids.reminder} className="mt-1 text-sm font-medium">
                        {t.telegram}
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
                          <option value={currentReminder}>{t.custom}</option>
                        )}
                        {reminderOptions.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </>
                  ) : null}
                  {readOnly ? null : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="justify-start"
                      onClick={() => setDue(null)}
                    >
                      <XIcon aria-hidden="true" />
                      {t.removeDue}
                    </Button>
                  )}
                </>
              ) : null}
            </fieldset>
          </fieldset>
        </aside>
        <div className="grid min-w-0 content-start gap-5 md:col-start-1 md:row-span-2 md:row-start-1">
          <Description
            card={card}
            readOnly={readOnly}
            onSave={(description) => save.mutate({ description })}
          />
          <Checklist card={card} readOnly={readOnly} run={(action) => run.mutate(action)} />
          <Attachments
            card={card}
            timeZone={timeZone}
            readOnly={readOnly}
            run={(action) => run.mutate(action)}
          />
          <Comments
            card={card}
            timeZone={timeZone}
            readOnly={readOnly}
            isOwner={isOwner}
            shared={shared}
            run={(action) => run.mutate(action)}
          />
          <Section title={t.activityTitle}>
            <ol className="grid gap-1 text-sm text-muted-foreground">
              {card.activity.map((entry) => (
                <li key={entry.id} className="flex flex-wrap justify-between gap-x-3">
                  <span>
                    {shared && entry.actorName ? (
                      <span className="font-medium text-foreground">{entry.actorName}: </span>
                    ) : null}
                    {describeActivity(entry.kind, entry.data)}
                  </span>
                  <time dateTime={entry.createdAt} className="text-xs">
                    {formatDateTime(entry.createdAt, timeZone)}
                  </time>
                </li>
              ))}
            </ol>
          </Section>
        </div>
        {readOnly ? null : (
          <div className="grid content-start gap-2 border-t pt-4 md:col-start-2 md:row-start-2">
            {card.archivedAt ? (
              <Button
                variant="outline"
                onClick={() => archive.mutate(false)}
                disabled={archive.isPending}
              >
                <ArchiveRestoreIcon aria-hidden="true" />
                {t.restore}
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={() => archive.mutate(true)}
                disabled={archive.isPending}
              >
                <ArchiveIcon aria-hidden="true" />
                {t.archive}
              </Button>
            )}
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={remove.isPending}
              onClick={() => {
                if (window.confirm(t.confirmDelete(card.title))) remove.mutate();
              }}
            >
              <Trash2Icon aria-hidden="true" />
              {t.delete}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function Description({
  card,
  readOnly,
  onSave,
}: {
  card: CardDetail;
  readOnly: boolean;
  onSave: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [text, setText] = useState(card.description);
  const id = useId();
  const t = workMessages().card;
  const startEditing = () => {
    setText(card.description);
    setTab("write");
    setEditing(true);
  };
  return (
    <Section title={t.description}>
      {editing ? (
        <div className="grid gap-2">
          <div role="tablist" aria-label={t.descriptionMode} className="flex gap-1">
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
                {value === "write" ? t.write : t.preview}
              </button>
            ))}
          </div>
          {tab === "write" ? (
            <textarea
              id={`${id}-write`}
              role="tabpanel"
              aria-label={t.markdown}
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
              {t.save}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {t.cancel}
            </Button>
            <span className="ml-auto self-center text-xs text-muted-foreground">
              {t.markdownHint}
            </span>
          </div>
        </div>
      ) : card.description ? (
        <div className="grid gap-2">
          <Markdown source={card.description} className="markdown text-sm" />
          {readOnly ? null : (
            <Button
              size="sm"
              variant="outline"
              className="justify-self-start"
              onClick={startEditing}
            >
              {t.editDescription}
            </Button>
          )}
        </div>
      ) : readOnly ? (
        <p className="text-sm text-muted-foreground">{t.noDescription}</p>
      ) : (
        <Button
          variant="outline"
          className="justify-start text-muted-foreground"
          onClick={startEditing}
        >
          {t.addDescription}
        </Button>
      )}
    </Section>
  );
}

type Run = (action: () => Promise<CardDetail>) => void;

function Checklist({ card, readOnly, run }: { card: CardDetail; readOnly: boolean; run: Run }) {
  const [text, setText] = useState("");
  const { done, total } = card.checklist;
  const t = workMessages().card;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    run(() => addChecklistItem(card.id, text.trim()));
    setText("");
  };
  return (
    <Section title={total > 0 ? t.checklistCount(done, total) : t.checklist}>
      {total > 0 ? (
        <div
          role="progressbar"
          aria-label={t.checklistProgress}
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
              disabled={readOnly}
              onChange={(e) => run(() => updateChecklistItem(item.id, { done: e.target.checked }))}
            />
            <label
              htmlFor={`check-${item.id}`}
              className={cn("flex-1", item.done && "text-muted-foreground line-through")}
            >
              {item.text}
            </label>
            {readOnly ? null : (
              <Button
                variant="ghost"
                size="icon"
                className="size-7 opacity-60 group-hover:opacity-100 pointer-coarse:size-10 pointer-coarse:opacity-100"
                aria-label={t.removeItem(item.text)}
                onClick={() => run(() => deleteChecklistItem(item.id))}
              >
                <XIcon aria-hidden="true" />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {readOnly && total === 0 ? (
        <p className="text-sm text-muted-foreground">{t.noItems}</p>
      ) : null}
      {!readOnly && total < KANBAN_LIMITS.checklistPerCard ? (
        <form onSubmit={submit} className="flex gap-2">
          <Input
            aria-label={t.newItem}
            placeholder={t.addItem}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={KANBAN_LIMITS.checklistText}
          />
          <Button type="submit" variant="outline" disabled={!text.trim()}>
            {t.add}
          </Button>
        </form>
      ) : null}
    </Section>
  );
}

const ACCEPT = ATTACHMENT_TYPES.join(",");

function Attachments({
  card,
  timeZone,
  readOnly,
  run,
}: {
  card: CardDetail;
  timeZone: string;
  readOnly: boolean;
  run: Run;
}) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const t = workMessages().card;
  const upload = useMutation({
    mutationFn: (file: File) => uploadAttachment(card.id, file),
    onSuccess: (updated) => {
      applyCard(queryClient, updated);
      toast.success(t.attachmentUploaded);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const pick = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (file.size > KANBAN_LIMITS.attachmentBytes) {
      toast.error(t.tooBig);
      return;
    }
    upload.mutate(file);
    if (input.current) input.current.value = "";
  };
  const full = card.attachmentList.length >= KANBAN_LIMITS.attachmentsPerCard;
  return (
    <Section title={t.attachments}>
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
                  aria-label={t.downloadFile(file.filename)}
                >
                  <DownloadIcon aria-hidden="true" />
                </a>
              </Button>
              {readOnly ? null : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 pointer-coarse:size-10"
                  aria-label={t.deleteFile(file.filename)}
                  onClick={() => {
                    if (window.confirm(t.confirmDeleteFile(file.filename)))
                      run(() => deleteAttachment(file.id));
                  }}
                >
                  <Trash2Icon aria-hidden="true" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : readOnly ? (
        <p className="text-sm text-muted-foreground">{t.noAttachments}</p>
      ) : null}
      {readOnly ? null : (
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
              {upload.isPending ? t.uploading : t.attach}
            </label>
          </Button>
          <span className="text-xs text-muted-foreground">{t.allowedFiles}</span>
        </div>
      )}
    </Section>
  );
}

function Comments({
  card,
  timeZone,
  readOnly,
  isOwner,
  shared,
  run,
}: {
  card: CardDetail;
  timeZone: string;
  readOnly: boolean;
  /** Quien creó el tablero puede borrar cualquier comentario (moderar). */
  isOwner: boolean;
  shared: boolean;
  run: Run;
}) {
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const t = workMessages().card;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    run(() => addComment(card.id, text.trim()));
    setText("");
  };
  return (
    <Section title={t.comments}>
      {readOnly ? null : (
        <form onSubmit={submit} className="grid gap-2">
          <textarea
            aria-label={t.newComment}
            placeholder={t.commentPlaceholder}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={KANBAN_LIMITS.comment}
            rows={2}
            className="w-full rounded-md border bg-background p-2 text-base sm:text-sm"
          />
          <Button type="submit" size="sm" className="justify-self-start" disabled={!text.trim()}>
            {t.comment}
          </Button>
        </form>
      )}
      {readOnly && card.commentList.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.noComments}</p>
      ) : null}
      <ul className="grid gap-2">
        {card.commentList.map((comment) => (
          <li key={comment.id} className="grid gap-1 rounded-md border p-2 text-sm">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {shared ? (
                <span className="font-medium text-foreground">
                  {comment.authorName ?? t.someone}
                </span>
              ) : null}
              <time dateTime={comment.createdAt}>
                {formatDateTime(comment.createdAt, timeZone)}
              </time>
              {comment.updatedAt !== comment.createdAt ? <span>{t.edited}</span> : null}
              {readOnly ? null : (
                <span className="ml-auto flex gap-1">
                  {comment.mine ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2"
                      onClick={() => setEditing({ id: comment.id, text: comment.body })}
                    >
                      {t.edit}
                    </Button>
                  ) : null}
                  {comment.mine || isOwner ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-destructive hover:text-destructive"
                      onClick={() => {
                        if (window.confirm(t.confirmDeleteComment))
                          run(() => deleteComment(comment.id));
                      }}
                    >
                      {t.deleteComment}
                    </Button>
                  ) : null}
                </span>
              )}
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
                  aria-label={t.editComment}
                  value={editing.text}
                  onChange={(e) => setEditing({ id: comment.id, text: e.target.value })}
                  maxLength={KANBAN_LIMITS.comment}
                  rows={2}
                  className="w-full rounded-md border bg-background p-2 text-base sm:text-sm"
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button type="submit" size="sm">
                    {t.save}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    {t.cancel}
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
