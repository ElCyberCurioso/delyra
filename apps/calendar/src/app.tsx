import { AppShell, HealthStatus } from "@delyra/ui";
import { CalendarDaysIcon } from "lucide-react";

/** Página provisional (F0-04): el calendario llega en la Fase 2. */
export function App() {
  return (
    <AppShell app="calendar" user={null}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section
          aria-labelledby="titulo"
          className="flex min-h-80 flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-card p-8 text-center"
        >
          <CalendarDaysIcon aria-hidden="true" className="size-10 text-primary" />
          <h1 id="titulo" className="text-2xl font-semibold tracking-tight">
            Calendario
          </h1>
          <p className="max-w-md text-muted-foreground">
            Aquí estarán tus vistas de mes, semana y día. De momento, esta página solo comprueba que
            la plataforma responde.
          </p>
        </section>
        <HealthStatus />
      </div>
    </AppShell>
  );
}
