import {
  type ActiveSession,
  AppShell,
  RequireSession,
  useAccountPreferences,
  useLogout,
} from "@delyra/ui";
import { useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";

/** Página con sesión completa y la cabecera común. Sin sesión, RequireSession lleva al login. */
export function CalendarLayout({ children }: { children: (session: ActiveSession) => ReactNode }) {
  const router = useRouter();
  const logout = useLogout();
  const preferences = useAccountPreferences();
  return (
    <RequireSession navigate={(path) => router.history.replace(path)}>
      {(session) => (
        <AppShell
          app="calendar"
          user={session.user}
          onSignOut={() => logout.mutate()}
          {...preferences}
        >
          {children(session)}
        </AppShell>
      )}
    </RequireSession>
  );
}
