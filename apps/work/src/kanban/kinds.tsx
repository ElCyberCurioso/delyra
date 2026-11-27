import { CARD_KINDS, type CardKind, KANBAN_LIMITS } from "@delyra/shared";
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
} from "@delyra/ui";
import {
  BriefcaseIcon,
  type LucideIcon,
  MailIcon,
  PhoneIcon,
  SquareCheckBigIcon,
  StickyNoteIcon,
  UserRoundIcon,
  UsersIcon,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { workMessages } from "./messages";

/**
 * Tipos de tarjeta (qué representa: tarea, reunión, llamada, correo, gestión o nota) y persona a
 * la que se ha pasado una tarjeta (columnas «depende de otra persona»).
 */

const KIND_ICONS: Record<CardKind, LucideIcon> = {
  task: SquareCheckBigIcon,
  meeting: UsersIcon,
  call: PhoneIcon,
  email: MailIcon,
  errand: BriefcaseIcon,
  note: StickyNoteIcon,
};

/** Tono de cada tipo (texto y fondo con contraste ≥ 4,5:1 en claro y en oscuro). */
const KIND_STYLES: Record<CardKind, string> = {
  task: "bg-slate-500/12 text-slate-700 dark:text-slate-200",
  meeting: "bg-violet-500/15 text-violet-800 dark:text-violet-200",
  call: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200",
  email: "bg-sky-500/15 text-sky-800 dark:text-sky-200",
  errand: "bg-amber-500/18 text-amber-900 dark:text-amber-200",
  note: "bg-rose-500/15 text-rose-800 dark:text-rose-200",
};

export const kindLabel = (kind: CardKind) => workMessages().kinds[kind];

export const kindOptions = () =>
  CARD_KINDS.map((kind) => ({ value: kind, label: kindLabel(kind) }));

export function KindBadge({ kind, className }: { kind: CardKind; className?: string }) {
  const Icon = KIND_ICONS[kind];
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.7rem] font-semibold",
        KIND_STYLES[kind],
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {kindLabel(kind)}
      {/* Separa el tipo del título en el nombre que se lee de la tarjeta. */}
      <span className="sr-only">. </span>
    </span>
  );
}

function initials(name: string): string {
  // Solo letras y números: «Laura (gestoría)» → «LG».
  const words = name
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  const first = words[0] ?? "";
  const second = words[1] ?? "";
  return (second ? `${first.charAt(0)}${second.charAt(0)}` : first.slice(0, 2)).toUpperCase();
}

/** «Depende de Laura»: se ve de un vistazo en la tarjeta (y se lee con ella). */
export function AssigneeTag({ name }: { name: string }) {
  const t = workMessages().assign;
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border bg-muted/60 py-0.5 pr-2 pl-0.5 text-xs">
      {/* Iniciales solo decorativas (como contenido CSS: no son texto de la página). */}
      <span
        aria-hidden="true"
        data-initials={initials(name)}
        className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-[0.6rem] font-bold text-primary-foreground before:content-[attr(data-initials)]"
      />
      <span className="min-w-0 truncate">
        <span className="text-muted-foreground">{t.dependsOn} </span>
        <span className="font-semibold">{name}</span>
      </span>
    </span>
  );
}

/** Pide a quién se le pasa una tarjeta al llevarla a una columna delegada. */
export function AssigneeDialog({
  request,
  onConfirm,
  onCancel,
}: {
  request: { cardTitle: string; columnName: string; current: string | null } | null;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const t = workMessages().assign;
  const [name, setName] = useState(request?.current ?? "");
  const [error, setError] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t.missing);
      return;
    }
    onConfirm(trimmed);
  };
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserRoundIcon aria-hidden="true" className="size-5" />
            {t.title}
          </DialogTitle>
          <DialogDescription>
            {request ? t.description(request.cardTitle, request.columnName) : null}
          </DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="grid gap-4">
          <Field
            label={t.name}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            maxLength={KANBAN_LIMITS.assignee}
            error={error ?? undefined}
            hint={t.hint}
            autoComplete="name"
            autoFocus
            required
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              {t.cancel}
            </Button>
            <Button type="submit">{t.confirm}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
