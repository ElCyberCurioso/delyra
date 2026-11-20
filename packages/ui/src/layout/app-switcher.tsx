import type { AppId, AppOrigins } from "@delyra/shared";
import { CalendarDaysIcon, SquareKanbanIcon } from "lucide-react";
import { cn } from "../lib/utils";

const APPS = [
  { id: "calendar", label: "Calendario", Icon: CalendarDaysIcon },
  { id: "work", label: "Trabajo", Icon: SquareKanbanIcon },
] as const satisfies readonly { id: AppId; label: string; Icon: unknown }[];

export interface AppSwitcherProps {
  current: AppId;
  origins: AppOrigins;
}

/** Selector Calendario / Trabajo. Cambia de dominio; la sesión es común (F1-13). */
export function AppSwitcher({ current, origins }: AppSwitcherProps) {
  return (
    <nav aria-label="Aplicaciones">
      <ul className="flex items-center gap-1 rounded-lg bg-muted p-1">
        {APPS.map(({ id, label, Icon }) => {
          const active = id === current;
          return (
            <li key={id}>
              <a
                href={`${origins[id]}/`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  active
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon aria-hidden="true" className="size-4" />
                <span className="hidden sm:inline">{label}</span>
                <span className="sr-only sm:hidden">{label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
