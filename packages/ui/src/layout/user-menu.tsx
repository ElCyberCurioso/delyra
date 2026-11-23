import { type Locale, type Palette, SUPPORTED_LOCALES } from "@delyra/shared";
import {
  LanguagesIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  PaletteIcon,
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
import { getLocale, LOCALE_NAMES, setLocale, ui } from "../i18n";
import { PALETTES } from "../theme/theme-init-script";
import { type Theme, useTheme } from "../theme/theme-provider";

export interface CurrentUser {
  name: string;
  email?: string;
  role?: "admin" | "member";
}

export interface UserMenuProps {
  user: CurrentUser | null;
  onSignOut?: () => void;
  /** Guarda el idioma en la cuenta (si no se pasa, solo cambia en este navegador). */
  onLocaleChange?: (locale: Locale) => void;
  /** Guarda la gama de color en la cuenta (además de aplicarla). */
  onPaletteChange?: (palette: Palette) => void;
  /** Ajustes de cuenta (en el calendario, también desde trabajo). */
  settingsHref?: string;
  /** Solo se muestra a administradores. */
  adminHref?: string;
}

const THEMES: { value: Theme; Icon: typeof SunIcon }[] = [
  { value: "light", Icon: SunIcon },
  { value: "dark", Icon: MoonIcon },
  { value: "system", Icon: MonitorIcon },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join("") || "?";
}

export function UserMenu({
  user,
  onSignOut,
  onLocaleChange,
  onPaletteChange,
  settingsHref,
  adminHref,
}: UserMenuProps) {
  const { theme, setTheme, palette, setPalette } = useTheme();
  const t = ui().userMenu;
  const changeLocale = onLocaleChange ?? ((locale: Locale) => void setLocale(locale));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm">
          <span
            aria-hidden="true"
            className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
          >
            {user ? initials(user.name) : <UserIcon className="size-4" />}
          </span>
          <span className="hidden max-w-40 truncate md:inline">{user?.name ?? t.signedOut}</span>
          <span className="sr-only">{t.label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <span className="block truncate">{user?.name ?? t.signedOut}</span>
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
                {t.settings}
              </a>
            </DropdownMenuItem>
            {user.role === "admin" && adminHref ? (
              <DropdownMenuItem asChild>
                <a href={adminHref}>
                  <ShieldIcon aria-hidden="true" />
                  {t.admin}
                </a>
              </DropdownMenuItem>
            ) : null}
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {t.theme}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as Theme)}>
          {THEMES.map(({ value, Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon aria-hidden="true" />
              {t[value]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
          <PaletteIcon aria-hidden="true" className="size-3.5" />
          {t.palette}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={palette}
          onValueChange={(value) => {
            const next = PALETTES.find((p) => p === value);
            if (next) {
              setPalette(next);
              onPaletteChange?.(next);
            }
          }}
        >
          {PALETTES.map((value) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <span
                aria-hidden="true"
                data-palette-swatch={value}
                className="size-4 rounded-full ring-1 ring-border"
              />
              {t.palettes[value]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
          <LanguagesIcon aria-hidden="true" className="size-3.5" />
          {t.language}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={getLocale()}
          onValueChange={(value) => {
            const locale = SUPPORTED_LOCALES.find((l) => l === value);
            if (locale && locale !== getLocale()) changeLocale(locale);
          }}
        >
          {SUPPORTED_LOCALES.map((locale) => (
            <DropdownMenuRadioItem key={locale} value={locale} lang={locale}>
              {LOCALE_NAMES[locale]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!user || !onSignOut} onSelect={() => onSignOut?.()}>
          <LogOutIcon aria-hidden="true" />
          {t.signOut}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
