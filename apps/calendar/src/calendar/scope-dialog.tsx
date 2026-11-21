import type { EditScope } from "@delyra/shared";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@delyra/ui";
import { useCallback, useRef, useState } from "react";

type Action = "edit" | "delete" | "move";

const COPY: Record<Action, { title: string; description: string }> = {
  edit: {
    title: "Guardar cambios",
    description: "Este evento se repite. ¿A qué ocurrencias afecta?",
  },
  move: { title: "Mover evento", description: "Este evento se repite. ¿Qué quieres mover?" },
  delete: { title: "Borrar evento", description: "Este evento se repite. ¿Qué quieres borrar?" },
};

const OPTIONS: { scope: EditScope; label: string }[] = [
  { scope: "this", label: "Solo este" },
  { scope: "following", label: "Este y los siguientes" },
  { scope: "all", label: "Todos" },
];

/**
 * Pregunta el alcance de un cambio en un evento que se repite (F2-05). `ask` devuelve el
 * alcance elegido o `null` si se cancela.
 */
export function useScopeDialog() {
  const [action, setAction] = useState<Action | null>(null);
  const [scopes, setScopes] = useState<readonly EditScope[]>(["this", "following", "all"]);
  const resolver = useRef<((scope: EditScope | null) => void) | null>(null);

  const ask = useCallback(
    (next: Action, allowed: readonly EditScope[] = ["this", "following", "all"]) => {
      setScopes(allowed);
      setAction(next);
      return new Promise<EditScope | null>((resolve) => {
        resolver.current = resolve;
      });
    },
    [],
  );

  const answer = (scope: EditScope | null) => {
    resolver.current?.(scope);
    resolver.current = null;
    setAction(null);
  };

  const copy = action ? COPY[action] : null;
  const dialog = (
    <Dialog open={action !== null} onOpenChange={(open) => !open && answer(null)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{copy?.title}</DialogTitle>
          <DialogDescription>{copy?.description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {OPTIONS.filter((option) => scopes.includes(option.scope)).map((option) => (
            <Button
              key={option.scope}
              variant={action === "delete" ? "outline" : "default"}
              className={action === "delete" ? "text-destructive" : undefined}
              onClick={() => answer(option.scope)}
            >
              {option.label}
            </Button>
          ))}
          <Button variant="ghost" onClick={() => answer(null)}>
            Cancelar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );

  return { ask, dialog };
}
