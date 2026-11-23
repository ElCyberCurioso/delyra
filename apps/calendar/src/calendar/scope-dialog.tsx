import type { EditScope } from "@delyra/shared";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@delyra/ui";
import { type ReactNode, useCallback, useRef, useState } from "react";
import { calendarMessages } from "./messages";

type Action = "edit" | "delete" | "move";

const SCOPES: readonly EditScope[] = ["this", "following", "all"];

/**
 * Pregunta el alcance de un cambio en un evento que se repite (F2-05). `ask` devuelve el
 * alcance elegido o `null` si se cancela.
 */
export function useScopeDialog() {
  const [action, setAction] = useState<Action | null>(null);
  const [scopes, setScopes] = useState<readonly EditScope[]>(["this", "following", "all"]);
  const [detail, setDetail] = useState<ReactNode>(null);
  const resolver = useRef<((scope: EditScope | null) => void) | null>(null);

  const ask = useCallback(
    (
      next: Action,
      allowed: readonly EditScope[] = ["this", "following", "all"],
      extra: ReactNode = null,
    ) => {
      setScopes(allowed);
      setDetail(extra);
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

  const t = calendarMessages().scope;
  const copy = action ? t[action] : null;
  const dialog = (
    <Dialog open={action !== null} onOpenChange={(open) => !open && answer(null)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{copy?.title}</DialogTitle>
          <DialogDescription>{copy?.description}</DialogDescription>
        </DialogHeader>
        {detail}
        <div className="grid gap-2">
          {SCOPES.filter((scope) => scopes.includes(scope)).map((scope) => (
            <Button
              key={scope}
              variant={action === "delete" ? "outline" : "default"}
              className={action === "delete" ? "text-destructive" : undefined}
              onClick={() => answer(scope)}
            >
              {t[scope]}
            </Button>
          ))}
          <Button variant="ghost" onClick={() => answer(null)}>
            {t.cancel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );

  return { ask, dialog };
}
