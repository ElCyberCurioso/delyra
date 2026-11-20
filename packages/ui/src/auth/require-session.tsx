import type { MeResponse } from "@delyra/shared";
import { LoaderCircleIcon } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { Button } from "../components/button";
import { errorMessage } from "./api";
import { goTo, pendingStepUrl, useMe } from "./session";

export type ActiveSession = MeResponse & {
  state: "active";
  user: NonNullable<MeResponse["user"]>;
  settings: NonNullable<MeResponse["settings"]>;
};

export function FullPageSpinner({ label = "Cargando…" }: { label?: string }) {
  return (
    <div
      role="status"
      className="flex min-h-dvh items-center justify-center gap-2 text-muted-foreground"
    >
      <LoaderCircleIcon aria-hidden="true" className="size-5 animate-spin" />
      <span>{label}</span>
    </div>
  );
}

/**
 * Solo pinta `children` con una sesión completa (contraseña + segundo factor). Si no la hay,
 * envía al paso pendiente en el calendario, recordando la URL actual para volver después.
 */
export function RequireSession({
  children,
  navigate,
}: {
  children: (session: ActiveSession) => ReactNode;
  /** Navegación interna de la SPA (evita recargar si el paso pendiente es del mismo origen). */
  navigate?: (path: string) => void;
}) {
  const me = useMe();
  const redirect = me.data ? pendingStepUrl(me.data.state) : null;

  useEffect(() => {
    if (redirect) goTo(redirect, navigate);
  }, [redirect, navigate]);

  if (me.isError) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <p role="alert">{errorMessage(me.error)}</p>
        <Button variant="outline" onClick={() => void me.refetch()}>
          Reintentar
        </Button>
      </div>
    );
  }
  if (!me.data || redirect || !me.data.user || !me.data.settings) {
    return <FullPageSpinner label={redirect ? "Redirigiendo al inicio de sesión…" : undefined} />;
  }
  return children(me.data as ActiveSession);
}
