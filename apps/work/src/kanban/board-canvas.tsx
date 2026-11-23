import {
  type Announcements,
  closestCenter,
  closestCorners,
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  getFirstCollision,
  type KeyboardCoordinateGetter,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { BoardColumn, BoardDetail, CardLabel, CardSummary } from "@delyra/shared";
import { Button, cn, Input, useMediaQuery } from "@delyra/ui";
import {
  AlignLeftIcon,
  CalendarClockIcon,
  CheckSquareIcon,
  ChevronDownIcon,
  GripVerticalIcon,
  MessageSquareIcon,
  PaperclipIcon,
  PlusIcon,
  Settings2Icon,
} from "lucide-react";
import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  cardIdsByColumn,
  dueLabel,
  isOverdue,
  priorityLabel,
  serverIndex,
  sortedColumns,
} from "./logic";
import { workMessages } from "./messages";

/**
 * Tablero con arrastrar y soltar (F4-08): tarjetas entre columnas y columnas entre sí, con
 * ratón, dedo o teclado (espacio para coger y soltar, flechas para mover, Escape cancela).
 * Mientras se arrastra, el orden vive en el estado local; al soltar se avisa al padre, que
 * aplica el cambio de forma optimista.
 */

export interface BoardCanvasProps {
  board: BoardDetail;
  /** Ids de las tarjetas visibles con los filtros actuales. */
  visible: ReadonlySet<string>;
  timeZone: string;
  now: number;
  onOpenCard: (id: string) => void;
  onMoveCard: (cardId: string, columnId: string, index: number) => void;
  onMoveColumn: (columnId: string, index: number) => void;
  onAddCard: (columnId: string, title: string) => Promise<unknown>;
  onEditColumn: (column: BoardColumn) => void;
  /** Solo lectura (F7-04): sin arrastrar, sin añadir y sin ajustes de columna. */
  readOnly?: boolean;
}

type Items = Record<string, string[]>;

/** Por debajo de este ancho (móvil en vertical) las columnas se apilan. */
const STACKED_QUERY = "(max-width: 639px)";

const HORIZONTAL = ["ArrowLeft", "ArrowRight"];

/**
 * Teclado (F4-08): arriba/abajo ordena dentro de la columna (lo de dnd-kit); izquierda/derecha
 * salta a la columna vecina, a la misma altura (o al hueco de la columna si está vacía). Las
 * columnas se mueven igual, de vecina en vecina.
 */
export function boardKeyboardCoordinates(items: Items, columns: readonly string[]) {
  const getter: KeyboardCoordinateGetter = (event, args) => {
    const { active, droppableRects, over } = args.context;
    if (!active || !HORIZONTAL.includes(event.code))
      return sortableKeyboardCoordinates(event, args);
    event.preventDefault();
    const step = event.code === "ArrowRight" ? 1 : -1;
    const id = String(active.id);
    if (columns.includes(id)) {
      // Durante el arrastre la columna no cambia de sitio en el estado: se parte de donde está ahora.
      const here = over && columns.includes(String(over.id)) ? String(over.id) : id;
      const target = columns[columns.indexOf(here) + step];
      const rect = target ? droppableRects.get(target) : undefined;
      return rect ? { x: rect.left, y: rect.top } : undefined;
    }
    const from = columns.find((column) => items[column]?.includes(id));
    const target = from ? columns[columns.indexOf(from) + step] : undefined;
    if (!from || !target) return undefined;
    const position = items[from]?.indexOf(id) ?? 0;
    const cards = items[target] ?? [];
    const neighbour = cards[Math.min(position, cards.length - 1)];
    const rect = droppableRects.get(neighbour ?? target);
    if (!rect) return undefined;
    // En una columna vacía, por debajo de la cabecera.
    return { x: rect.left, y: neighbour ? rect.top : rect.top + 48 };
  };
  return getter;
}

function visibleItems(board: BoardDetail, visible: ReadonlySet<string>): Items {
  const all = cardIdsByColumn(board);
  return Object.fromEntries(
    Object.entries(all).map(([column, ids]) => [column, ids.filter((id) => visible.has(id))]),
  );
}

export function BoardCanvas(props: BoardCanvasProps) {
  const { board, visible, onMoveCard, onMoveColumn } = props;
  const columns = useMemo(() => sortedColumns(board), [board]);
  const columnIds = useMemo(() => columns.map((c) => c.id), [columns]);
  const cardsById = useMemo(() => new Map(board.cards.map((c) => [c.id, c])), [board.cards]);
  const [items, setItems] = useState<Items>(() => visibleItems(board, visible));
  const [active, setActive] = useState<UniqueIdentifier | null>(null);
  const dragging = useRef(false);
  const [columnOrder, setColumnOrder] = useState<string[]>(columnIds);
  const itemsRef = useRef(items);
  const orderRef = useRef(columnOrder);
  const lastOver = useRef<UniqueIdentifier | null>(null);
  // Móvil en vertical: las columnas se apilan (se ven todas sin desplazarse de lado).
  const stacked = useMediaQuery(STACKED_QUERY);
  useEffect(() => {
    itemsRef.current = items;
    orderRef.current = columnOrder;
  }, [items, columnOrder]);
  // Lee el orden vigente al pulsar cada tecla (los refs se actualizan durante el arrastre).
  const coordinateGetter = useCallback<KeyboardCoordinateGetter>(
    (event, args) => boardKeyboardCoordinates(itemsRef.current, orderRef.current)(event, args),
    [],
  );

  // Fuera de un arrastre, el estado local sigue a los datos (incluida la actualización optimista:
  // al soltar no se vuelve al orden anterior mientras llega).
  useEffect(() => {
    if (dragging.current) return;
    setItems(visibleItems(board, visible));
    setColumnOrder(columnIds);
  }, [board, visible, columnIds]);

  const sensors = useSensors(
    // Ratón y dedo por separado: con el dedo, deslizar desplaza el tablero y una pulsación
    // larga coge la tarjeta (con PointerSensor, deslizar arrastraría).
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter,
      // Intro abre la tarjeta; solo el espacio la coge.
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] },
    }),
  );

  const isColumn = (id: UniqueIdentifier) => columnIds.includes(String(id));
  const containerOf = (id: UniqueIdentifier): string | null => {
    const key = String(id);
    if (key in items) return key;
    return Object.keys(items).find((column) => items[column]?.includes(key)) ?? null;
  };

  // Colisiones al estilo «varios contenedores» de dnd-kit: primero lo que hay bajo el puntero
  // (o bajo la tarjeta, con teclado); si es una columna con tarjetas, la tarjeta más cercana.
  const collision: CollisionDetection = (args) => {
    if (isColumn(args.active.id)) {
      return closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter((c) => isColumn(c.id)),
      });
    }
    // Con teclado no hay puntero: el destino es la tarjeta (o columna) en la que el
    // coordinateGetter ha colocado la tarjeta, y closestCorners la encuentra exacta.
    if (!args.pointerCoordinates) return closestCorners(args);
    const pointer = pointerWithin(args);
    const hits = pointer.length > 0 ? pointer : rectIntersection(args);
    let overId = getFirstCollision(hits, "id");
    if (overId !== null) {
      const cards = items[String(overId)];
      if (cards && cards.length > 0) {
        overId =
          closestCenter({
            ...args,
            droppableContainers: args.droppableContainers.filter((c) =>
              cards.includes(String(c.id)),
            ),
          })[0]?.id ?? overId;
      }
      lastOver.current = overId;
      return [{ id: overId }];
    }
    return lastOver.current !== null ? [{ id: lastOver.current }] : [];
  };

  const t = workMessages().canvas;
  const columnName = (id: string | null) => columns.find((c) => c.id === id)?.name ?? "";
  const titleOf = (id: UniqueIdentifier) =>
    cardsById.get(String(id))?.title ?? columnName(String(id));
  /** «sobre «Otra», en «Columna»» o «en «Columna»» si está sobre la columna (vacía). */
  const whereIs = (over: UniqueIdentifier) => {
    const key = String(over);
    if (isColumn(key)) return t.inColumn(columnName(key));
    return t.overCard(titleOf(key), columnName(containerOf(key)));
  };
  const announcements: Announcements = {
    onDragStart: ({ active: a }) =>
      isColumn(a.id) ? t.pickedColumn(titleOf(a.id)) : t.picked(titleOf(a.id)),
    onDragOver: ({ active: a, over }) => {
      if (!over) return undefined;
      if (isColumn(a.id)) {
        return over.id === a.id
          ? t.columnInPlace(titleOf(a.id))
          : t.columnNext(titleOf(a.id), titleOf(over.id));
      }
      return over.id === a.id
        ? t.inPlace(titleOf(a.id), columnName(containerOf(a.id)))
        : t.isAt(titleOf(a.id), whereIs(over.id));
    },
    onDragEnd: ({ active: a, over }) =>
      over
        ? isColumn(a.id)
          ? t.columnPlaced(titleOf(a.id))
          : t.dropped(titleOf(a.id), whereIs(over.id))
        : t.back(titleOf(a.id)),
    onDragCancel: ({ active: a }) => t.cancelled(titleOf(a.id)),
  };

  const onDragStart = ({ active: a }: DragStartEvent) => {
    dragging.current = true;
    setActive(a.id);
  };

  const onDragOver = ({ active: a, over }: DragOverEvent) => {
    if (!over || isColumn(a.id)) return;
    const from = containerOf(a.id);
    const to = containerOf(over.id);
    if (!from || !to || from === to) return;
    setItems((current) => {
      const source = (current[from] ?? []).filter((id) => id !== String(a.id));
      const target = [...(current[to] ?? [])];
      const overIndex = target.indexOf(String(over.id));
      const below =
        over.rect && a.rect.current.translated
          ? a.rect.current.translated.top > over.rect.top + over.rect.height / 2
          : false;
      const index = overIndex >= 0 ? overIndex + (below ? 1 : 0) : target.length;
      target.splice(index, 0, String(a.id));
      return { ...current, [from]: source, [to]: target };
    });
  };

  const finish = () => {
    dragging.current = false;
    setActive(null);
  };

  const onDragEnd = ({ active: a, over }: DragEndEvent) => {
    finish();
    if (!over) {
      setItems(visibleItems(board, visible));
      return;
    }
    if (isColumn(a.id)) {
      const from = columnOrder.indexOf(String(a.id));
      const to = columnOrder.indexOf(String(over.id));
      if (from < 0 || to < 0 || from === to) return;
      setColumnOrder(arrayMove(columnOrder, from, to));
      onMoveColumn(String(a.id), to);
      return;
    }
    const column = containerOf(a.id);
    if (!column) return;
    let list = items[column] ?? [];
    const overIndex = list.indexOf(String(over.id));
    const fromIndex = list.indexOf(String(a.id));
    if (overIndex >= 0 && fromIndex >= 0 && overIndex !== fromIndex) {
      list = arrayMove(list, fromIndex, overIndex);
      setItems((current) => ({ ...current, [column]: list }));
    }
    const card = cardsById.get(String(a.id));
    const full = cardIdsByColumn(board)[column] ?? [];
    const index = serverIndex(full, list, String(a.id));
    if (!card) return;
    const reordered = full.filter((id) => id !== card.id);
    reordered.splice(index, 0, card.id);
    const unchanged = card.columnId === column && reordered.every((id, i) => id === full[i]);
    if (unchanged) return;
    onMoveCard(card.id, column, index);
  };

  const activeCard = active !== null ? cardsById.get(String(active)) : undefined;
  const activeColumn = active !== null ? columns.find((c) => c.id === active) : undefined;
  const ordered = columnOrder
    .map((id) => columns.find((c) => c.id === id))
    .filter((c): c is BoardColumn => c !== undefined);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        finish();
        setItems(visibleItems(board, visible));
      }}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: t.instructions,
        },
      }}
    >
      <SortableContext
        items={columnOrder}
        strategy={stacked ? verticalListSortingStrategy : horizontalListSortingStrategy}
      >
        <ol
          className={cn(
            // `relative`: los textos sr-only (posición absoluta) quedan dentro del scroll y no
            // ensanchan la página.
            "relative flex gap-5 pb-4",
            // Escritorio y tableta: en fila, todas de la altura del tablero.
            "sm:items-stretch sm:overflow-x-auto sm:overscroll-x-contain",
            // Móvil en vertical: una debajo de otra.
            "max-sm:flex-col max-sm:gap-4",
          )}
          aria-label={t.columns}
        >
          {ordered.map((column) => (
            <SortableColumn
              key={column.id}
              column={column}
              cardIds={items[column.id] ?? []}
              total={board.cards.filter((c) => c.columnId === column.id).length}
              {...props}
              cardsById={cardsById}
            />
          ))}
        </ol>
      </SortableContext>
      <DragOverlay>
        {activeCard ? (
          <CardView card={activeCard} labels={board.labels} {...props} overlay />
        ) : activeColumn ? (
          <div className="w-[min(21rem,90vw)] rounded-2xl border bg-muted/80 p-3 font-medium shadow-lg">
            {activeColumn.name}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function SortableColumn({
  column,
  cardIds,
  total,
  cardsById,
  board,
  onAddCard,
  onEditColumn,
  readOnly = false,
  ...props
}: BoardCanvasProps & {
  column: BoardColumn;
  cardIds: string[];
  total: number;
  cardsById: Map<string, CardSummary>;
}) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: column.id, disabled: readOnly });
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition };
  const over = column.wipLimit !== null && total > column.wipLimit;
  const headingId = `columna-${column.id}`;
  const listId = `tarjetas-${column.id}`;
  const t = workMessages().canvas;
  // En el móvil cada columna se puede plegar para ver el tablero de un vistazo.
  const [collapsed, setCollapsed] = useState(false);
  return (
    <li
      ref={setNodeRef}
      style={style}
      aria-labelledby={headingId}
      data-testid="column"
      className={cn(
        "animate-rise relative flex flex-col rounded-3xl border bg-muted/50 shadow-[var(--shadow-tile)] backdrop-blur-sm",
        // Más anchas y de la altura del tablero; la lista se desplaza por dentro.
        "sm:h-[calc(100dvh-15rem)] sm:min-h-[30rem] sm:w-[21rem] sm:shrink-0 xl:w-[22.5rem]",
        "max-sm:w-full",
        isDragging && "opacity-50",
      )}
    >
      <div className={cn("flex items-center gap-1 px-2 pt-2", readOnly && "min-h-10 pl-3")}>
        {readOnly ? null : (
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={t.moveColumn(column.name)}
            className="cursor-grab touch-manipulation rounded p-1 text-muted-foreground hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none active:cursor-grabbing pointer-coarse:p-2.5"
          >
            <GripVerticalIcon aria-hidden="true" className="size-4" />
          </button>
        )}
        <h2
          id={headingId}
          className="min-w-0 flex-1 truncate text-[0.95rem] font-bold tracking-tight"
        >
          {column.name}
        </h2>
        <Button
          variant="ghost"
          size="icon"
          className="size-9 sm:hidden"
          aria-expanded={!collapsed}
          aria-controls={listId}
          aria-label={t.toggleColumn(column.name)}
          onClick={() => setCollapsed((value) => !value)}
        >
          <ChevronDownIcon
            aria-hidden="true"
            className={cn("transition-transform", collapsed && "-rotate-90")}
          />
        </Button>
        <span
          className={cn(
            "rounded-full bg-card px-2.5 py-0.5 text-xs font-semibold tabular-nums shadow-xs",
            over ? "bg-destructive/15 font-medium text-destructive" : "text-muted-foreground",
          )}
          title={column.wipLimit !== null ? t.wipLimit(column.wipLimit) : undefined}
        >
          {column.wipLimit !== null ? `${String(total)}/${String(column.wipLimit)}` : total}
          {over ? <span className="sr-only">{t.overWip}</span> : null}
        </span>
        {readOnly ? null : (
          <Button
            variant="ghost"
            size="icon"
            className="size-7 pointer-coarse:size-10"
            aria-label={t.columnSettings(column.name)}
            onClick={() => onEditColumn(column)}
          >
            <Settings2Icon aria-hidden="true" />
          </Button>
        )}
      </div>
      <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
        <ul
          id={listId}
          className={cn(
            "flex min-h-16 flex-1 flex-col gap-2.5 p-2.5 sm:overflow-y-auto",
            collapsed && "max-sm:hidden",
          )}
          aria-labelledby={headingId}
        >
          {cardIds.map((id) => {
            const card = cardsById.get(id);
            return card ? (
              <SortableCard
                key={id}
                card={card}
                labels={board.labels}
                onOpenCard={props.onOpenCard}
                timeZone={props.timeZone}
                now={props.now}
                readOnly={readOnly}
              />
            ) : null;
          })}
        </ul>
      </SortableContext>
      {readOnly || collapsed ? null : (
        <AddCard columnName={column.name} onAdd={(title) => onAddCard(column.id, title)} />
      )}
    </li>
  );
}

type CardViewProps = Pick<BoardCanvasProps, "timeZone" | "now"> & {
  card: CardSummary;
  labels: readonly CardLabel[];
  overlay?: boolean;
};

function SortableCard({
  card,
  labels,
  onOpenCard,
  timeZone,
  now,
  readOnly,
}: Pick<BoardCanvasProps, "onOpenCard" | "timeZone" | "now"> & {
  card: CardSummary;
  labels: readonly CardLabel[];
  readOnly: boolean;
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: card.id,
    disabled: readOnly,
  });
  if (readOnly) {
    // Sin arrastre: un botón que abre la tarjeta.
    return (
      <li>
        <button
          type="button"
          aria-label={card.title}
          data-testid="card"
          onClick={() => onOpenCard(card.id)}
          className="lift w-full rounded-2xl text-left focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <CardView card={card} labels={labels} timeZone={timeZone} now={now} />
        </button>
      </li>
    );
  }
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    listeners?.onKeyDown?.(event);
    if (event.key === "Enter" && !event.defaultPrevented) onOpenCard(card.id);
  };
  return (
    <li ref={setNodeRef} style={style} className={cn(isDragging && "opacity-40")}>
      <div
        {...attributes}
        {...listeners}
        onKeyDown={onKeyDown}
        aria-roledescription={workMessages().canvas.card}
        aria-label={card.title}
        data-testid="card"
        onClick={() => onOpenCard(card.id)}
        // Sin menú contextual ni selección de texto al mantener pulsado para arrastrar.
        className="lift cursor-pointer touch-manipulation rounded-2xl select-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none [-webkit-touch-callout:none]"
      >
        <CardView card={card} labels={labels} timeZone={timeZone} now={now} />
      </div>
    </li>
  );
}

const PRIORITY_STYLES = {
  none: "",
  low: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  medium: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  high: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  urgent: "bg-destructive/15 text-destructive",
} as const;

export function CardView({ card, labels, timeZone, now, overlay = false }: CardViewProps) {
  const cardLabels = labels.filter((l) => card.labelIds.includes(l.id));
  const overdue = isOverdue(card, now, timeZone);
  const t = workMessages().canvas;
  const meta: ReactNode[] = [];
  if (card.hasDescription) {
    meta.push(<AlignLeftIcon key="d" aria-label={t.hasDescription} className="size-3.5" />);
  }
  if (card.checklist.total > 0) {
    meta.push(
      <span key="c" className="inline-flex items-center gap-1">
        <CheckSquareIcon aria-hidden="true" className="size-3.5" />
        <span>
          {card.checklist.done}/{card.checklist.total}
          <span className="sr-only">{t.checklistDone}</span>
        </span>
      </span>,
    );
  }
  if (card.comments > 0) {
    meta.push(
      <span key="m" className="inline-flex items-center gap-1">
        <MessageSquareIcon aria-hidden="true" className="size-3.5" />
        {card.comments}
        <span className="sr-only">{t.comments}</span>
      </span>,
    );
  }
  if (card.attachments > 0) {
    meta.push(
      <span key="a" className="inline-flex items-center gap-1">
        <PaperclipIcon aria-hidden="true" className="size-3.5" />
        {card.attachments}
        <span className="sr-only">{t.attachments}</span>
      </span>,
    );
  }
  return (
    <div
      className={cn(
        "grid gap-2.5 rounded-2xl border bg-card p-3.5 text-sm shadow-[var(--shadow-tile)]",
        // Las tarjetas nuevas aparecen con un pequeño rebote (no la que se arrastra).
        !overlay && "animate-pop",
        overlay && "w-68 rotate-1 shadow-lg",
        card.color && "pl-4",
        card.completedAt && "opacity-80",
      )}
      style={card.color ? { boxShadow: `inset 5px 0 0 ${card.color}` } : undefined}
    >
      {cardLabels.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {cardLabels.map((label) => (
            <span
              key={label.id}
              className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs"
            >
              <span
                aria-hidden="true"
                className="size-2 rounded-full"
                style={{ backgroundColor: label.color }}
              />
              {label.name}
            </span>
          ))}
        </div>
      ) : null}
      <p
        className={cn(
          "leading-snug font-semibold break-words",
          card.completedAt && "text-muted-foreground line-through decoration-1",
        )}
      >
        {card.title}
      </p>
      {card.priority !== "none" || card.due || meta.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {card.priority !== "none" ? (
            <span
              className={cn("rounded px-1.5 py-0.5 font-medium", PRIORITY_STYLES[card.priority])}
            >
              {priorityLabel(card.priority)}
            </span>
          ) : null}
          {card.due ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded px-1.5 py-0.5",
                overdue && "bg-destructive/15 font-medium text-destructive",
                card.completedAt && "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
              )}
            >
              <CalendarClockIcon aria-hidden="true" className="size-3.5" />
              <span className="sr-only">{t.due}</span>
              {dueLabel(card.due, timeZone, now)}
              {overdue ? <span className="sr-only">{t.overdue}</span> : null}
            </span>
          ) : null}
          {meta}
        </div>
      ) : null}
    </div>
  );
}

function AddCard({
  columnName,
  onAdd,
}: {
  columnName: string;
  onAdd: (title: string) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const t = workMessages().canvas;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      await onAdd(title.trim());
      setTitle("");
    } finally {
      setBusy(false);
    }
  };
  if (!open) {
    return (
      <div className="p-2 pt-0">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start rounded-xl text-muted-foreground hover:bg-card"
          onClick={() => setOpen(true)}
        >
          <PlusIcon aria-hidden="true" />
          {t.addCard}
          <span className="sr-only">{t.inColumnSr(columnName)}</span>
        </Button>
      </div>
    );
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="grid gap-2 p-2 pt-0">
      <Input
        aria-label={t.newCardTitle(columnName)}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder={t.newCardPlaceholder}
        maxLength={300}
        autoFocus
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy || !title.trim()}>
          {t.add}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t.cancel}
        </Button>
      </div>
    </form>
  );
}
