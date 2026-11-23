import { localeSchema, type MeResponse, paletteSchema } from "@delyra/shared";
import { LoaderCircleIcon } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { Button } from "../components/button";
import { getLocale, setLocale, ui } from "../i18n";
import { rememberUser } from "../lib/offline";
import { useOptionalTheme } from "../theme/theme-provider";
import { errorMessage } from "./api";
import { goTo, pendingStepUrl, useMe } from "./session";

export type ActiveSession = MeResponse & {
  state: "active";
  user: NonNullable<MeResponse["user"]>;
  settings: NonNullable<MeResponse["settings"]>;
};

export function FullPageSpinner({ label }: { label?: string }) {
  return (
    <div
      role="status"
      className="flex min-h-dvh items-center justify-center gap-2 text-muted-foreground"
    >
      <LoaderCircleIcon aria-hidden="true" className="size-5 animate-spin" />
      <span>{label ?? ui().common.loading}</span>
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

  // Si entra otra cuenta en este navegador, se vacía la caché sin conexión (F7-01).
  const userId = me.data?.user?.id;
  useEffect(() => {
    if (userId) void rememberUser(userId);
  }, [userId]);

  // F7-06: el idioma de la cuenta manda sobre el del navegador.
  const accountLocale = localeSchema.safeParse(me.data?.settings?.locale).data;
  useEffect(() => {
    if (accountLocale && accountLocale !== getLocale()) void setLocale(accountLocale);
  }, [accountLocale]);

  // La gama de color también es de la cuenta: igual en las dos apps y en cualquier dispositivo.
  const theme = useOptionalTheme();
  const accountPalette = paletteSchema.safeParse(me.data?.settings?.palette).data;
  const currentPalette = theme?.palette;
  const setPalette = theme?.setPalette;
  useEffect(() => {
    if (accountPalette && setPalette && accountPalette !== currentPalette)
      setPalette(accountPalette);
  }, [accountPalette, currentPalette, setPalette]);

  if (me.isError) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <p role="alert">{errorMessage(me.error)}</p>
        <Button variant="outline" onClick={() => void me.refetch()}>
          {ui().common.retry}
        </Button>
      </div>
    );
  }
  if (!me.data || redirect || !me.data.user || !me.data.settings) {
    return <FullPageSpinner label={redirect ? ui().common.redirectingToLogin : undefined} />;
  }
  return children(me.data as ActiveSession);
}
