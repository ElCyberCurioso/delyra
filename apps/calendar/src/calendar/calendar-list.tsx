import { CALENDAR_COLORS, type CalendarInfo } from "@delyra/shared";
import {
  Button,
  cn,
  Dialog,
  DialogClose,
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
  toast,
} from "@delyra/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { DownloadIcon, LockIcon, MoreHorizontalIcon, PlusIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import {
  CALENDARS_KEY,
  createCalendar,
  deleteCalendar,
  updateCalendar,
  useInvalidateEvents,
} from "./api";

export function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium">Color</legend>
      <div className="flex flex-wrap gap-2">
        {CALENDAR_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`Color ${color}`}
            aria-pressed={value === color}
            onClick={() => onChange(color)}
            className={cn(
              "size-7 rounded-full ring-offset-2 ring-offset-background",
              value === color && "ring-2 ring-ring",
            )}
            style={{ backgroundColor: color }}
          />
        ))}
      </div>
    </fieldset>
  );
}

type Editing = { kind: "create" } | { kind: "edit"; calendar: CalendarInfo } | null;

function CalendarDialog({ editing, onClose }: { editing: Editing; onClose: () => void }) {
  const queryClient = useQueryClient();
  const current = editing?.kind === "edit" ? editing.calendar : null;
  const [name, setName] = useState(current?.name ?? "");
  const [color, setColor] = useState(current?.color ?? CALENDAR_COLORS[0]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Ponle un nombre.");
      return;
    }
    setPending(true);
    try {
      if (current) await updateCalendar(current.id, { name: name.trim(), color });
      else await createCalendar({ name: name.trim(), color });
      await queryClient.invalidateQueries({ queryKey: CALENDARS_KEY });
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={editing !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{current ? "Editar calendario" : "Nuevo calendario"}</DialogTitle>
          <DialogDescription className="sr-only">Nombre y color del calendario.</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={(event) => void submit(event)} className="grid gap-4">
          <FormError>{error}</FormError>
          <Field
            label="Nombre"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            autoFocus
          />
          <ColorPicker value={color} onChange={setColor} />
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancelar</Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Calendarios con su color y visibilidad, y su gestión (F2-11). */
export function CalendarList({ calendars }: { calendars: readonly CalendarInfo[] }) {
  const queryClient = useQueryClient();
  const invalidateEvents = useInvalidateEvents();
  const [editing, setEditing] = useState<Editing>(null);
  const [removing, setRemoving] = useState<CalendarInfo | null>(null);

  async function toggle(calendar: CalendarInfo) {
    // Optimista: la visibilidad cambia al instante y se deshace si falla.
    queryClient.setQueryData<CalendarInfo[]>(CALENDARS_KEY, (old) =>
      old?.map((c) => (c.id === calendar.id ? { ...c, visible: !c.visible } : c)),
    );
    try {
      await updateCalendar(calendar.id, { visible: !calendar.visible });
    } catch (caught) {
      toast.error(errorMessage(caught));
      await queryClient.invalidateQueries({ queryKey: CALENDARS_KEY });
    }
  }

  async function remove(calendar: CalendarInfo) {
    try {
      await deleteCalendar(calendar.id);
      toast.success(`Calendario «${calendar.name}» borrado`);
      await queryClient.invalidateQueries({ queryKey: CALENDARS_KEY });
      await invalidateEvents();
    } catch (caught) {
      toast.error(errorMessage(caught));
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-sm font-medium">Calendarios</h2>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Nuevo calendario"
          onClick={() => setEditing({ kind: "create" })}
        >
          <PlusIcon aria-hidden="true" />
        </Button>
      </div>
      <ul className="grid gap-0.5">
        {calendars.map((calendar) => (
          <li
            key={calendar.id}
            className="group flex items-center gap-2 rounded-md px-1 hover:bg-accent"
          >
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1.5 text-sm">
              <input
                type="checkbox"
                className="size-4 shrink-0 rounded"
                style={{ accentColor: calendar.color }}
                checked={calendar.visible}
                onChange={() => void toggle(calendar)}
              />
              <span className="truncate">{calendar.name}</span>
              {calendar.readOnly ? (
                <LockIcon
                  aria-label="Suscripción de solo lectura"
                  className="size-3.5 shrink-0 text-muted-foreground"
                />
              ) : null}
            </label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 opacity-60 group-hover:opacity-100"
                  aria-label={`Opciones de ${calendar.name}`}
                >
                  <MoreHorizontalIcon aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEditing({ kind: "edit", calendar })}>
                  Editar nombre y color
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={`/api/calendars/${calendar.id}/export`} download>
                    Exportar (.ics)
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  disabled={calendars.length <= 1}
                  onSelect={() => setRemoving(calendar)}
                >
                  {calendar.readOnly ? "Quitar suscripción" : "Borrar"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        ))}
      </ul>
      <Link
        to="/importar"
        className="mt-1 flex items-center gap-2 rounded-md px-1 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      >
        <DownloadIcon aria-hidden="true" className="size-4" />
        Importar desde Google
      </Link>
      {editing ? (
        <CalendarDialog
          key={editing.kind === "edit" ? editing.calendar.id : "new"}
          editing={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
      <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Borrar «{removing?.name}»</DialogTitle>
            <DialogDescription>
              Se borrarán también todos sus eventos y sus alertas. No se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancelar</Button>
            </DialogClose>
            <Button variant="destructive" onClick={() => removing && void remove(removing)}>
              Borrar calendario
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
