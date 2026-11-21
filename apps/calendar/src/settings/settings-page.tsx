import { AppShell, RequireSession, useLogout } from "@delyra/ui";
import { useRouter } from "@tanstack/react-router";
import { PasswordSection, ProfileSection } from "./profile-section";
import { ActivitySection, SessionsSection } from "./sessions-section";
import { TwoFactorSection } from "./two-factor-section";

const NAV = [
  { href: "#perfil", label: "Perfil y preferencias" },
  { href: "#contrasena", label: "Contraseña" },
  { href: "#verificacion", label: "Verificación en dos pasos" },
  { href: "#sesiones", label: "Sesiones activas" },
  { href: "#actividad", label: "Actividad reciente" },
];

/** Ajustes de cuenta (F1-15) e historial de seguridad (F1-16). */
export function SettingsPage() {
  const router = useRouter();
  const logout = useLogout();
  return (
    <RequireSession navigate={(path) => router.history.replace(path)}>
      {(session) => (
        <AppShell app="calendar" user={session.user} onSignOut={() => logout.mutate()}>
          <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Ajustes</h1>
              <nav aria-label="Secciones de ajustes" className="mt-4 hidden lg:block">
                <ul className="grid gap-1 text-sm">
                  {NAV.map((item) => (
                    <li key={item.href}>
                      <a
                        href={item.href}
                        className="block rounded-md px-2 py-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      >
                        {item.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            </div>
            <div className="grid gap-6">
              <ProfileSection session={session} />
              <PasswordSection />
              <TwoFactorSection session={session} />
              <SessionsSection session={session} />
              <ActivitySection session={session} />
            </div>
          </div>
        </AppShell>
      )}
    </RequireSession>
  );
}
