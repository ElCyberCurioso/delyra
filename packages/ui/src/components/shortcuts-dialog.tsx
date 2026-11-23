import { ui } from "../i18n";
import type { Shortcut } from "../lib/use-shortcuts";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./dialog";

/** Ayuda de atajos (tecla «?»). */
export function ShortcutsDialog({
  open,
  onOpenChange,
  shortcuts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shortcuts: readonly Pick<Shortcut, "label" | "description">[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{ui().shortcuts.title}</DialogTitle>
          <DialogDescription>{ui().shortcuts.description}</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
          {shortcuts.map((shortcut) => (
            <div key={shortcut.label} className="contents">
              <dt>
                <kbd className="inline-flex min-w-7 justify-center rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">
                  {shortcut.label}
                </kbd>
              </dt>
              <dd className="text-muted-foreground">{shortcut.description}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
