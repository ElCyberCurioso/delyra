import {
  googleAccountCalendarsResponseSchema,
  googleAuthorizeResponseSchema,
  googleStatusResponseSchema,
  googleSyncResponseSchema,
  type ImportInfo,
  importResponseSchema,
  importsResponseSchema,
  problemDetailsSchema,
  type StartImportRequest,
  type SubscriptionInfo,
  subscriptionResponseSchema,
  subscriptionsResponseSchema,
} from "@delyra/shared";
import { ApiError, apiFetch } from "@delyra/ui";
import { useQuery } from "@tanstack/react-query";

/** Importación desde Google (F5-03) y suscripciones iCal (F5-06). */

export const IMPORTS_KEY = ["imports"] as const;
export const GOOGLE_SYNC_KEY = ["google", "sync"] as const;
export const SUBSCRIPTIONS_KEY = ["subscriptions"] as const;
export const importKey = (id: string) => [...IMPORTS_KEY, id] as const;

const RUNNING = new Set<ImportInfo["status"]>(["analyzing", "importing"]);

export function useImport(id: string) {
  return useQuery({
    queryKey: importKey(id),
    queryFn: ({ signal }) =>
      apiFetch(`/api/imports/${id}`, { schema: importResponseSchema, signal }).then(
        (r) => r.import,
      ),
    // Mientras el Workflow trabaja, se consulta el progreso.
    refetchInterval: (query) =>
      query.state.data && RUNNING.has(query.state.data.status) ? 1500 : false,
  });
}

export function useImports() {
  return useQuery({
    queryKey: IMPORTS_KEY,
    queryFn: ({ signal }) =>
      apiFetch("/api/imports", { schema: importsResponseSchema, signal }).then((r) => r.imports),
  });
}

export function useGoogleStatus() {
  return useQuery({
    queryKey: ["google", "status"],
    queryFn: ({ signal }) =>
      apiFetch("/api/google/status", { schema: googleStatusResponseSchema, signal }),
    staleTime: 5 * 60_000,
  });
}

export function useSubscriptions() {
  return useQuery({
    queryKey: SUBSCRIPTIONS_KEY,
    queryFn: ({ signal }) =>
      apiFetch("/api/subscriptions", { schema: subscriptionsResponseSchema, signal }).then(
        (r) => r.subscriptions,
      ),
  });
}

/**
 * Sube el fichero como cuerpo binario, como los adjuntos del kanban: la API lo guarda en R2 en
 * streaming y decide el tipo por el contenido. El nombre va en `X-Filename`.
 */
export async function uploadImport(file: File): Promise<ImportInfo> {
  const response = await fetch(new URL("/api/imports", window.location.origin), {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": file.type || "application/octet-stream",
      "X-Filename": encodeURIComponent(file.name),
    },
    body: file,
  });
  if (!response.ok) {
    let problem = null;
    try {
      problem = problemDetailsSchema.parse(await response.json());
    } catch {
      // Sin problem+json: basta con el código.
    }
    throw new ApiError(response.status, problem);
  }
  return importResponseSchema.parse(await response.json()).import;
}

export const startImport = (id: string, body: StartImportRequest) =>
  apiFetch(`/api/imports/${id}/start`, { method: "POST", body, schema: importResponseSchema }).then(
    (r) => r.import,
  );

export const discardImport = (id: string) => apiFetch(`/api/imports/${id}`, { method: "DELETE" });

export const authorizeGoogle = () =>
  apiFetch("/api/google/authorize", { method: "POST", schema: googleAuthorizeResponseSchema });

export const subscribe = (url: string): Promise<SubscriptionInfo> =>
  apiFetch("/api/subscriptions", {
    method: "POST",
    body: { url },
    schema: subscriptionResponseSchema,
  }).then((r) => r.subscription);

export const syncSubscription = (id: string): Promise<SubscriptionInfo> =>
  apiFetch(`/api/subscriptions/${id}/sync`, {
    method: "POST",
    schema: subscriptionResponseSchema,
  }).then((r) => r.subscription);

export const unsubscribe = (id: string) =>
  apiFetch(`/api/subscriptions/${id}`, { method: "DELETE" });

// ── Sincronización continua con Google (F7-09) ───────────────────────────────

export function useGoogleSync() {
  return useQuery({
    queryKey: GOOGLE_SYNC_KEY,
    queryFn: ({ signal }) =>
      apiFetch("/api/google/sync", { schema: googleSyncResponseSchema, signal }),
    // Mientras se hace la primera descarga de un calendario, se consulta su estado.
    refetchInterval: (query) =>
      query.state.data?.calendars.some((c) => c.status === "pending") ? 2000 : false,
  });
}

export function useGoogleAccountCalendars(enabled: boolean) {
  return useQuery({
    queryKey: [...GOOGLE_SYNC_KEY, "available"],
    enabled,
    retry: false,
    staleTime: 60_000,
    queryFn: ({ signal }) =>
      apiFetch("/api/google/sync/available", {
        schema: googleAccountCalendarsResponseSchema,
        signal,
      }).then((r) => r.calendars),
  });
}

export const authorizeGoogleSync = () =>
  apiFetch("/api/google/sync/authorize", {
    method: "POST",
    schema: googleAuthorizeResponseSchema,
  });

export const addGoogleSync = (googleCalendarId: string, reminders: boolean) =>
  apiFetch("/api/google/sync/calendars", {
    method: "POST",
    body: { googleCalendarId, reminders },
    schema: googleSyncResponseSchema,
  });

export const syncGoogleNow = (id: string) =>
  apiFetch(`/api/google/sync/calendars/${id}/sync`, {
    method: "POST",
    schema: googleSyncResponseSchema,
  });

export const removeGoogleSync = (id: string) =>
  apiFetch(`/api/google/sync/calendars/${id}`, { method: "DELETE" });

export const disconnectGoogleSync = () => apiFetch("/api/google/sync", { method: "DELETE" });
