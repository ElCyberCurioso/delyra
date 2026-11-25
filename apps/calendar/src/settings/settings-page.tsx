import { AppShell, RequireSession, useAccountPreferences, useLogout } from "@delyra/ui";
import { useRouter } from "@tanstack/react-router";
import { BackupsSection } from "./backups-section";
import { DeleteAccountSection } from "./delete-account-section";
import { PasswordSection, ProfileSection } from "./profile-section";
import { ActivitySection, SessionsSection } from "./sessions-section";
import { TelegramSection } from "./telegram-section";
import { TwoFactorSection } from "./two-factor-section";
import { settingsMessages } from "./messages";

const NAV = [
  "perfil",
  "contrasena",
  "verificacion",
  "telegram",
  "copias",
  "sesiones",
  "actividad",
  "eliminar",
] as const;

/** Ajustes de cuenta (F1-15) e historial de seguridad (F1-16). */
export function SettingsPage() {
  const router = useRouter();
  const logout = useLogout();
  const preferences = useAccountPreferences();
  const t = settingsMessages().page;
  return (
    <RequireSession navigate={(path) => router.history.replace(path)}>
      {(session) => (
        <AppShell
          app="calendar"
          user={session.user}
          onSignOut={() => logout.mutate()}
          {...preferences}
        >
          <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
            <div className="lg:sticky lg:top-24 lg:self-start">
              <h1 className="animate-rise text-3xl font-bold tracking-tight">{t.title}</h1>
              <nav aria-label={t.sections} className="tile animate-rise mt-5 hidden p-2 lg:block">
                <ul className="grid gap-0.5 text-sm">
                  {NAV.map((id) => (
                    <li key={id}>
                      <a
                        href={`#${id}`}
                        className="block rounded-xl px-3 py-2 font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                      >
                        {t.nav[id]}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            </div>
            <div className="grid items-start gap-5 xl:grid-cols-2 xl:[&>#actividad]:col-span-2 xl:[&>#eliminar]:col-span-2 xl:[&>#copias]:col-span-2 xl:[&>#perfil]:col-span-2 [&>:nth-child(2)]:[--i:1] [&>:nth-child(3)]:[--i:2] [&>:nth-child(4)]:[--i:3] [&>:nth-child(5)]:[--i:4] [&>:nth-child(6)]:[--i:5] [&>:nth-child(7)]:[--i:6] [&>:nth-child(8)]:[--i:7]">
              <ProfileSection session={session} />
              <PasswordSection />
              <TwoFactorSection session={session} />
              <TelegramSection session={session} />
              <BackupsSection session={session} />
              <SessionsSection session={session} />
              <ActivitySection session={session} />
              <DeleteAccountSection />
            </div>
          </div>
        </AppShell>
      )}
    </RequireSession>
  );
}
