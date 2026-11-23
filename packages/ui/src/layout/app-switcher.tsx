import type { AppId, AppOrigins } from "@delyra/shared";
import { CalendarDaysIcon, SquareKanbanIcon } from "lucide-react";
import { ui } from "../i18n";
import { cn } from "../lib/utils";

const APPS = [
  { id: "calendar", Icon: CalendarDaysIcon },
  { id: "work", Icon: SquareKanbanIcon },
] as const satisfies readonly { id: AppId; Icon: unknown }[];

export interface AppSwitcherProps {
  current: AppId;
  origins: AppOrigins;
}

/** Selector Calendario / Trabajo. Cambia de dominio; la sesión es común (F1-13). */
export function AppSwitcher({ current, origins }: AppSwitcherProps) {
  return (
    <nav aria-label={ui().shell.apps}>
      <ul className="flex items-center gap-1 rounded-2xl border bg-muted/70 p-1">
        {APPS.map(({ id, Icon }) => {
          const label = ui().shell[id];
          const active = id === current;
          return (
            <li key={id}>
              <a
                href={`${origins[id]}/`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "press inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm font-semibold transition-[color,background-color,box-shadow] duration-200 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  active
                    ? "bg-card text-foreground shadow-[var(--shadow-tile)]"
                    : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
                )}
              >
                <Icon aria-hidden="true" className={cn("size-4", active && "text-primary")} />
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
