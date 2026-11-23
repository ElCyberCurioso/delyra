import {
  type AppEnvironment,
  type AuthConfigResponse,
  authConfigResponseSchema,
  findAppByOrigin,
  type Locale,
  type MeResponse,
  type Palette,
  meResponseSchema,
  safeNext,
} from "@delyra/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { setLocale } from "../i18n";
import { currentAppOrigins } from "../layout/app-shell";
import { clearOfflineData, forgetUser } from "../lib/offline";
import { ApiError, apiFetch } from "./api";

/** Sin sesión, `/api/auth/me` responde 401: se representa como estado `anonymous`. */
export type SessionInfo = MeResponse | { state: "anonymous"; user: null; settings: null };

export const ME_QUERY_KEY = ["auth", "me"] as const;

export async function fetchMe(signal?: AbortSignal): Promise<SessionInfo> {
  try {
    return await apiFetch("/api/auth/me", { schema: meResponseSchema, signal });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return { state: "anonymous", user: null, settings: null };
    }
    throw error;
  }
}

export function useMe() {
  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: ({ signal }) => fetchMe(signal),
    staleTime: 60_000,
    retry: (count, error) => !(error instanceof ApiError) && count < 2,
  });
}

export function fetchAuthConfig(signal?: AbortSignal): Promise<AuthConfigResponse> {
  return apiFetch("/api/auth/config", { schema: authConfigResponseSchema, signal });
}

export function useAuthConfig() {
  return useQuery({
    queryKey: ["auth", "config"],
    queryFn: ({ signal }) => fetchAuthConfig(signal),
    staleTime: Infinity,
  });
}

/** Entorno de la SPA según su origen (local si no coincide con ninguno conocido). */
export function currentEnvironment(): AppEnvironment {
  return findAppByOrigin(window.location.origin)?.environment ?? "development";
}

/** Destino seguro tras iniciar sesión: solo rutas propias u orígenes de Delyra. */
export function resolveNext(next: string | null | undefined, fallback = "/"): string {
  return safeNext(currentEnvironment(), next, fallback);
}

/** Pantalla del calendario (donde viven login, registro y 2FA) con el destino posterior. */
export function authUrl(
  path: "/login" | "/login/verificar" | "/configurar-2fa",
  next = window.location.href,
): string {
  const url = new URL(path, currentAppOrigins().calendar);
  url.searchParams.set("next", next);
  return url.href;
}

/** Pantalla que corresponde a una sesión que aún no está completa. */
export function pendingStepUrl(state: SessionInfo["state"], next?: string): string | null {
  if (state === "pending_2fa") return authUrl("/login/verificar", next);
  if (state === "pending_totp") return authUrl("/configurar-2fa", next);
  if (state === "anonymous") return authUrl("/login", next);
  return null;
}

/** Navega a otra URL; si es del mismo origen, `navigate` evita recargar la SPA. */
export function goTo(href: string, navigate?: (path: string) => void) {
  const url = new URL(href, window.location.origin);
  if (navigate && url.origin === window.location.origin) {
    navigate(`${url.pathname}${url.search}${url.hash}`);
  } else {
    window.location.assign(url.href);
  }
}

/**
 * Cierra la sesión y lleva al login con una carga completa de página, que ya descarta la caché.
 * No se vacía la caché antes: `RequireSession` volvería a pedir `/me` y redirigiría por su cuenta
 * (con `?next=`), en carrera con esta navegación.
 */
/**
 * Cambia el idioma (F7-06). Con sesión se guarda en la cuenta (también lo usan los correos y
 * Telegram); sin ella, solo en este navegador.
 */
export function useChangeLocale() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (locale: Locale) => {
      const me = queryClient.getQueryData<SessionInfo>(ME_QUERY_KEY);
      if (me?.state === "active" && me.settings) {
        const { timeZone, weekStart } = me.settings;
        await apiFetch("/api/me/settings", {
          method: "PATCH",
          body: { timeZone, weekStart, locale },
        });
        queryClient.setQueryData<SessionInfo>(ME_QUERY_KEY, {
          ...me,
          settings: { ...me.settings, locale },
        });
      }
      await setLocale(locale);
    },
  });
}

/** Guarda la gama de color en la cuenta (la aplica quien llama, al momento). */
export function useChangePalette() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (palette: Palette) => {
      const me = queryClient.getQueryData<SessionInfo>(ME_QUERY_KEY);
      if (me?.state !== "active" || !me.settings) return;
      const { timeZone, weekStart, locale } = me.settings;
      await apiFetch("/api/me/settings", {
        method: "PATCH",
        body: { timeZone, weekStart, locale, palette },
      });
      queryClient.setQueryData<SessionInfo>(ME_QUERY_KEY, {
        ...me,
        settings: { ...me.settings, palette },
      });
    },
  });
}

/** Idioma y gama de la cuenta para el menú de usuario (`<AppShell {...preferences}>`). */
export function useAccountPreferences() {
  const locale = useChangeLocale();
  const palette = useChangePalette();
  return {
    onLocaleChange: (next: Locale) => locale.mutate(next),
    onPaletteChange: (next: Palette) => palette.mutate(next),
  };
}

export function useLogout() {
  return useMutation({
    mutationFn: () => apiFetch("/api/auth/logout", { method: "POST" }),
    onSettled: async () => {
      // F7-01: lo guardado para usar la app sin conexión no sobrevive al cierre de sesión.
      forgetUser();
      await clearOfflineData();
      window.location.assign(new URL("/login", currentAppOrigins().calendar).href);
    },
  });
}
