import {
  APP_ORIGINS,
  type AppId,
  type AppOrigins,
  findAppByOrigin,
  type Locale,
} from "@delyra/shared";
import type { ReactNode } from "react";
import { Toaster } from "../components/toaster";
import { ui } from "../i18n";
import { AppSwitcher } from "./app-switcher";
import { Brand } from "./brand";
import { type CurrentUser, UserMenu } from "./user-menu";

/** Orígenes de las dos apps según dónde se ejecuta la SPA (producción o local). */
export function currentAppOrigins(): AppOrigins {
  return findAppByOrigin(window.location.origin)?.origins ?? APP_ORIGINS.development;
}

export interface AppShellProps {
  app: AppId;
  user: CurrentUser | null;
  onSignOut?: () => void;
  /** Guarda el idioma en la cuenta; sin él, solo cambia en este navegador. */
  onLocaleChange?: (locale: Locale) => void;
  origins?: AppOrigins;
  children: ReactNode;
}

/** Layout común: cabecera con marca, selector de app y menú de usuario. */
export function AppShell({
  app,
  user,
  onSignOut,
  onLocaleChange,
  origins,
  children,
}: AppShellProps) {
  const resolvedOrigins = origins ?? currentAppOrigins();
  return (
    <div className="flex min-h-dvh flex-col text-foreground">
      <a
        href="#contenido"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        {ui().shell.skipToContent}
      </a>
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/65">
        <div className="mx-auto flex h-16 w-full max-w-screen-2xl items-center gap-4 px-4 sm:px-6">
          <Brand href={`${resolvedOrigins[app]}/`} />
          <AppSwitcher current={app} origins={resolvedOrigins} />
          <div className="ml-auto">
            <UserMenu
              user={user}
              onSignOut={onSignOut}
              onLocaleChange={onLocaleChange}
              settingsHref={`${resolvedOrigins.calendar}/ajustes`}
              adminHref={`${resolvedOrigins.calendar}/admin`}
            />
          </div>
        </div>
      </header>
      <main
        id="contenido"
        tabIndex={-1}
        className="mx-auto w-full max-w-screen-2xl flex-1 px-4 py-6 outline-none sm:px-6 sm:py-8"
      >
        {children}
      </main>
      <Toaster />
    </div>
  );
}
