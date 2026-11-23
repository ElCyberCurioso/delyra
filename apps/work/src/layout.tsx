import {
  type ActiveSession,
  AppShell,
  RequireSession,
  useChangeLocale,
  useLogout,
} from "@delyra/ui";
import type { ReactNode } from "react";

/**
 * Página con sesión completa y la cabecera común. Sin sesión, RequireSession lleva al login
 * del calendario y vuelve aquí después.
 */
export function WorkLayout({ children }: { children: (session: ActiveSession) => ReactNode }) {
  const logout = useLogout();
  const changeLocale = useChangeLocale();
  return (
    <RequireSession>
      {(session) => (
        <AppShell
          app="work"
          user={session.user}
          onSignOut={() => logout.mutate()}
          onLocaleChange={(locale) => changeLocale.mutate(locale)}
        >
          {children(session)}
        </AppShell>
      )}
    </RequireSession>
  );
}
