import {
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  SettingsIcon,
  ShieldIcon,
  SunIcon,
  UserIcon,
} from "lucide-react";
import { Button } from "../components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/dropdown-menu";
import { type Theme, useTheme } from "../theme/theme-provider";

export interface CurrentUser {
  name: string;
  email?: string;
  role?: "admin" | "member";
}

export interface UserMenuProps {
  user: CurrentUser | null;
  onSignOut?: () => void;
  /** Ajustes de cuenta (en el calendario, también desde trabajo). */
  settingsHref?: string;
  /** Solo se muestra a administradores. */
  adminHref?: string;
}

const THEMES: { value: Theme; label: string; Icon: typeof SunIcon }[] = [
  { value: "light", label: "Claro", Icon: SunIcon },
  { value: "dark", label: "Oscuro", Icon: MoonIcon },
  { value: "system", label: "Sistema", Icon: MonitorIcon },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join("") || "?";
}

export function UserMenu({ user, onSignOut, settingsHref, adminHref }: UserMenuProps) {
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="Menú de usuario">
          <span
            aria-hidden="true"
            className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
          >
            {user ? initials(user.name) : <UserIcon className="size-4" />}
          </span>
          <span className="hidden max-w-40 truncate md:inline">{user?.name ?? "Sin sesión"}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <span className="block truncate">{user?.name ?? "Sin sesión"}</span>
          {user?.email ? (
            <span className="block truncate text-xs font-normal text-muted-foreground">
              {user.email}
            </span>
          ) : null}
        </DropdownMenuLabel>
        {user && settingsHref ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href={settingsHref}>
                <SettingsIcon aria-hidden="true" />
                Ajustes
              </a>
            </DropdownMenuItem>
            {user.role === "admin" && adminHref ? (
              <DropdownMenuItem asChild>
                <a href={adminHref}>
                  <ShieldIcon aria-hidden="true" />
                  Administración
                </a>
              </DropdownMenuItem>
            ) : null}
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Tema
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as Theme)}>
          {THEMES.map(({ value, label, Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon aria-hidden="true" />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!user || !onSignOut} onSelect={() => onSignOut?.()}>
          <LogOutIcon aria-hidden="true" />
          Cerrar sesión
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
