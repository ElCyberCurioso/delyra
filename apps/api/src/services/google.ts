import {
  APP_ORIGINS,
  type AppEnvironment,
  appEnvironmentSchema,
  dateOnlyToUtc,
  EVENT_LIMITS,
  fromFloating,
  isValidTimeZone,
} from "@delyra/shared";
import { randomToken, sha256Base64Url } from "../lib/crypto";
import { decryptField, encryptField, type Keyring } from "../lib/field-crypto";
import { convertRrule } from "../lib/ics";
import {
  cleanColor,
  cleanReminders,
  cleanText,
  cleanTitle,
  cleanUid,
  finalizeEvents,
  fixRange,
  IMPORT_LIMITS,
  type ImportedEvent,
  ImportFormatError,
  ImportLimitError,
  Warnings,
} from "../lib/import-model";

/**
 * Google Calendar (F5-04, F5-05).
 *
 * - OAuth 2.0 con authorization code + PKCE (S256). El `state` y el `code_verifier` viajan en
 *   una cookie cifrada y autenticada (AES-GCM), ligada al usuario y válida 10 minutos.
 * - Scope `calendar.readonly`. Para importar, `access_type=online`: Google no entrega refresh
 *   token y el token de acceso (~1 h) solo se usa durante el análisis, cifrado, y se borra al
 *   terminar. Para la sincronización continua (F7-09, ADR-0014), `access_type=offline`: el token
 *   de actualización se guarda cifrado en `google_connections` (services/google-sync.ts).
 * - `calendarList` y `events.list` paginados con `singleEvents=false`: se conservan las RRULE,
 *   las excepciones y las ocurrencias canceladas (que llegan como `status: cancelled`).
 */

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GOOGLE_API = "https://www.googleapis.com/calendar/v3";
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
export const OAUTH_COOKIE = "__Secure-delyra-google";
export const OAUTH_TTL_MS = 10 * 60_000;

const DAY_MS = 86_400_000;
const STATE_AAD = "google-oauth-state";

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function googleConfig(env: {
  APP_ENV: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}): GoogleConfig | null {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
  const environment: AppEnvironment = appEnvironmentSchema.parse(env.APP_ENV);
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: `${APP_ORIGINS[environment].calendar}/api/google/callback`,
  };
}

// ── OAuth ────────────────────────────────────────────────────────────────────

/** `import`: una importación puntual. `sync`: conexión para la sincronización continua. */
export type OAuthPurpose = "import" | "sync";

export interface OAuthState {
  state: string;
  verifier: string;
  userId: string;
  expiresAt: number;
  purpose: OAuthPurpose;
}

export function newOAuthState(
  userId: string,
  now: number,
  purpose: OAuthPurpose = "import",
): OAuthState {
  return {
    state: randomToken(32),
    verifier: randomToken(48),
    userId,
    expiresAt: now + OAUTH_TTL_MS,
    purpose,
  };
}

export async function sealOAuthState(state: OAuthState, keyring: Keyring): Promise<string> {
  return encryptField(JSON.stringify(state), keyring, STATE_AAD);
}

/** Abre la cookie; null si está manipulada, es de otra clave o no tiene la forma esperada. */
export async function openOAuthState(value: string, keyring: Keyring): Promise<OAuthState | null> {
  try {
    const parsed = JSON.parse(await decryptField(value, keyring, STATE_AAD)) as Partial<OAuthState>;
    if (
      typeof parsed.state === "string" &&
      typeof parsed.verifier === "string" &&
      typeof parsed.userId === "string" &&
      typeof parsed.expiresAt === "number"
    ) {
      return {
        state: parsed.state,
        verifier: parsed.verifier,
        userId: parsed.userId,
        expiresAt: parsed.expiresAt,
        purpose: parsed.purpose === "sync" ? "sync" : "import",
      };
    }
  } catch {
    // Cookie manipulada o cifrada con otra clave.
  }
  return null;
}

export async function authorizeUrl(config: GoogleConfig, state: OAuthState): Promise<string> {
  const url = new URL(GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPE,
    // Solo la sincronización pide acceso permanente; `consent` hace que Google lo vuelva a dar
    // aunque la cuenta ya hubiera autorizado a Delyra antes.
    access_type: state.purpose === "sync" ? "offline" : "online",
    include_granted_scopes: "false",
    prompt: state.purpose === "sync" ? "consent select_account" : "select_account",
    state: state.state,
    code_challenge: await sha256Base64Url(state.verifier),
    code_challenge_method: "S256",
  }).toString();
  return url.href;
}

class GoogleAuthError extends Error {
  override name = "GoogleAuthError";
}

/**
 * Canjea el código por los tokens. Quien importa ignora el de actualización; solo la
 * sincronización continua lo guarda (cifrado).
 */
export async function exchangeCode(
  config: GoogleConfig,
  code: string,
  verifier: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  scope: string;
}> {
  const response = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new GoogleAuthError(`Google rechazó el código (${String(response.status)})`);
  const body = await response.json<{
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
    scope?: unknown;
  }>();
  if (typeof body.access_token !== "string" || body.access_token.length > 4096) {
    throw new GoogleAuthError("Respuesta de Google sin token de acceso");
  }
  const scope = typeof body.scope === "string" ? body.scope : "";
  if (!scope.split(" ").includes(GOOGLE_SCOPE)) {
    throw new GoogleAuthError("No se concedió acceso de lectura al calendario");
  }
  return {
    accessToken: body.access_token,
    refreshToken:
      typeof body.refresh_token === "string" && body.refresh_token.length <= 4096
        ? body.refresh_token
        : null,
    expiresIn: typeof body.expires_in === "number" ? body.expires_in : 3600,
    scope,
  };
}

/** Google ha retirado el permiso (o ha caducado): hace falta volver a conectar. */
export class GoogleRevokedError extends Error {
  override name = "GoogleRevokedError";
  constructor() {
    super("Google ha retirado el permiso de Delyra. Vuelve a conectar tu cuenta.");
  }
}

/** Pide un token de acceso nuevo con el de actualización. */
export async function refreshAccessToken(
  config: GoogleConfig,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ accessToken: string; expiresIn: number }> {
  const response = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 400 || response.status === 401) {
    const body = await response.json<{ error?: unknown }>().catch(() => ({ error: undefined }));
    if (body.error === "invalid_grant" || body.error === "unauthorized_client") {
      throw new GoogleRevokedError();
    }
  }
  if (!response.ok) {
    throw new GoogleApiError(response.status, `Google respondió ${String(response.status)}`);
  }
  const body = await response.json<{ access_token?: unknown; expires_in?: unknown }>();
  if (typeof body.access_token !== "string" || body.access_token.length > 4096) {
    throw new GoogleApiError(502, "Respuesta de Google sin token de acceso");
  }
  return {
    accessToken: body.access_token,
    expiresIn: typeof body.expires_in === "number" ? body.expires_in : 3600,
  };
}

/** Revoca el permiso en Google (al desconectar). Si falla, el token ya no se guarda igualmente. */
export async function revokeGoogleToken(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(GOOGLE_REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

const tokenAad = (ownerId: string, importId: string) => `google-token:${ownerId}:${importId}`;

export async function sealToken(
  token: string,
  keyring: Keyring,
  ownerId: string,
  importId: string,
) {
  return encryptField(token, keyring, tokenAad(ownerId, importId));
}

export async function openToken(
  value: string | null,
  keyring: Keyring,
  ownerId: string,
  importId: string,
): Promise<string> {
  if (!value)
    throw new ImportFormatError("La autorización de Google ha caducado. Vuelve a conectar.");
  return decryptField(value, keyring, tokenAad(ownerId, importId));
}

// ── API de Calendar ──────────────────────────────────────────────────────────

interface GoogleReminder {
  method?: string;
  minutes?: number;
}

export interface GoogleCalendarEntry {
  id: string;
  summary?: string;
  summaryOverride?: string;
  backgroundColor?: string;
  timeZone?: string;
  accessRole?: string;
  primary?: boolean;
  defaultReminders?: GoogleReminder[];
}

interface GoogleTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface GoogleEvent {
  id: string;
  iCalUID?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleTime;
  end?: GoogleTime;
  recurrence?: string[];
  recurringEventId?: string;
  originalStartTime?: GoogleTime;
  reminders?: { useDefault?: boolean; overrides?: GoogleReminder[] };
  eventType?: string;
}

export class GoogleApiError extends Error {
  override name = "GoogleApiError";
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** El token de acceso ya no vale (401). */
export class GoogleUnauthorizedError extends ImportFormatError {
  override name = "GoogleUnauthorizedError";
}

const EVENT_FIELDS =
  "nextPageToken,nextSyncToken,items(id,iCalUID,status,summary,description,location,start,end," +
  "recurrence,recurringEventId,originalStartTime,reminders,eventType)";

export class GoogleCalendarClient {
  /** `nextSyncToken` de la última descarga completa de eventos (para la sincronización). */
  nextSyncToken: string | null = null;

  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async get<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = new URL(`${GOOGLE_API}${path}`);
    url.search = new URLSearchParams(params).toString();
    const response = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" },
      // Workers no admite `redirect: "error"`: con «manual», un 3xx no es `ok` y falla.
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 401) {
      throw new GoogleUnauthorizedError(
        "La autorización de Google ha caducado. Vuelve a conectar.",
      );
    }
    if (!response.ok) {
      throw new GoogleApiError(
        response.status,
        `Google Calendar respondió ${String(response.status)}`,
      );
    }
    return response.json<T>();
  }

  async calendarList(): Promise<GoogleCalendarEntry[]> {
    const result: GoogleCalendarEntry[] = [];
    let pageToken: string | undefined;
    do {
      const page = await this.get<{ items?: GoogleCalendarEntry[]; nextPageToken?: string }>(
        "/users/me/calendarList",
        { maxResults: "250", ...(pageToken ? { pageToken } : {}) },
      );
      result.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
      if (result.length > IMPORT_LIMITS.calendars) {
        throw new ImportLimitError(
          `Tu cuenta tiene más de ${String(IMPORT_LIMITS.calendars)} calendarios`,
        );
      }
    } while (pageToken);
    return result;
  }

  /** Un calendario de la lista de la cuenta (404 si ya no está o no hay acceso). */
  async calendarEntry(calendarId: string): Promise<GoogleCalendarEntry> {
    return this.get<GoogleCalendarEntry>(
      `/users/me/calendarList/${encodeURIComponent(calendarId)}`,
      {},
    );
  }

  async *events(calendarId: string): AsyncGenerator<GoogleEvent[]> {
    this.nextSyncToken = null;
    let pageToken: string | undefined;
    do {
      const page = await this.get<{
        items?: GoogleEvent[];
        nextPageToken?: string;
        nextSyncToken?: string;
      }>(`/calendars/${encodeURIComponent(calendarId)}/events`, {
        maxResults: "2500",
        singleEvents: "false",
        showDeleted: "false",
        fields: EVENT_FIELDS,
        ...(pageToken ? { pageToken } : {}),
      });
      yield page.items ?? [];
      pageToken = page.nextPageToken;
      if (page.nextSyncToken) this.nextSyncToken = page.nextSyncToken.slice(0, 1024);
    } while (pageToken);
  }

  /**
   * Cuántos eventos han cambiado desde `syncToken` (sincronización incremental). Lanza
   * `GoogleApiError` 410 si el token ya no vale y hay que descargarlo todo.
   */
  async changesSince(
    calendarId: string,
    syncToken: string,
  ): Promise<{ changed: number; nextSyncToken: string | null }> {
    let changed = 0;
    let next: string | null = null;
    let pageToken: string | undefined;
    do {
      const page = await this.get<{
        items?: unknown[];
        nextPageToken?: string;
        nextSyncToken?: string;
      }>(`/calendars/${encodeURIComponent(calendarId)}/events`, {
        maxResults: "2500",
        singleEvents: "false",
        showDeleted: "false",
        syncToken,
        fields: "nextPageToken,nextSyncToken,items(id)",
        ...(pageToken ? { pageToken } : {}),
      });
      changed += page.items?.length ?? 0;
      pageToken = page.nextPageToken;
      if (page.nextSyncToken) next = page.nextSyncToken.slice(0, 1024);
    } while (pageToken);
    return { changed, nextSyncToken: next };
  }
}

// ── Conversión ───────────────────────────────────────────────────────────────

export interface CalendarMeta {
  id: string;
  name: string;
  color: string | null;
  timeZone: string | null;
  defaultReminders: number[];
  suggestSkip: boolean;
}

/** Datos de cada calendario de la cuenta (lo que se muestra en la vista previa). */
export function calendarMeta(entry: GoogleCalendarEntry): CalendarMeta {
  const id = entry.id.slice(0, 300);
  return {
    id,
    name: cleanText(entry.summaryOverride ?? entry.summary, 60) ?? "Calendario de Google",
    color: cleanColor(entry.backgroundColor),
    timeZone: entry.timeZone && isValidTimeZone(entry.timeZone) ? entry.timeZone : null,
    defaultReminders: (entry.defaultReminders ?? [])
      .map((r) => r.minutes)
      .filter((m): m is number => typeof m === "number"),
    // Festivos y números de semana de Google: se proponen sin importar (F7-03 trae los propios).
    suggestSkip:
      /#(holiday|weeknum)@group\.v\.calendar\.google\.com$/.test(id) ||
      entry.accessRole === "freeBusyReader",
  };
}

function googleTime(time: GoogleTime | undefined, fallbackTz: string) {
  if (time?.date) {
    return { ms: dateOnlyToUtc(time.date), allDay: true, tz: fallbackTz };
  }
  if (time?.dateTime) {
    const ms = Date.parse(time.dateTime);
    if (Number.isNaN(ms)) return null;
    const tz = time.timeZone && isValidTimeZone(time.timeZone) ? time.timeZone : fallbackTz;
    return { ms, allDay: false, tz };
  }
  return null;
}

/** `EXDATE;TZID=Europe/Madrid:20261129T100000,20261206T100000` → instantes. */
function parseExdateLine(line: string, allDay: boolean, tz: string): number[] {
  const colon = line.indexOf(":");
  if (colon < 0) return [];
  const params = line.slice(0, colon).split(";").slice(1);
  const tzid = params
    .find((p) => p.toUpperCase().startsWith("TZID="))
    ?.slice(5)
    .replace(/^"|"$/g, "");
  const zone = tzid && isValidTimeZone(tzid) ? tzid : tz;
  const result: number[] = [];
  for (const value of line.slice(colon + 1).split(",")) {
    const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim());
    if (!match) continue;
    const [, y, mo, d, h, mi, s, z] = match;
    const date = [Number(y), Number(mo) - 1, Number(d)] as const;
    if (allDay || h === undefined) {
      result.push(Date.UTC(...date));
      continue;
    }
    const wall = Date.UTC(...date, Number(h), Number(mi), Number(s));
    result.push(z ? wall : fromFloating(wall, zone));
  }
  return result;
}

/** Convierte una página de `events.list` (las canceladas se devuelven aparte). */
function convertGoogleEvents(
  items: readonly GoogleEvent[],
  meta: CalendarMeta,
  defaultTimeZone: string,
  uidsById: Map<string, string>,
  warnings: Warnings,
): { events: ImportedEvent[]; cancelled: { masterId: string; recurrenceId: number }[] } {
  const calendarTz = meta.timeZone ?? defaultTimeZone;
  const events: ImportedEvent[] = [];
  const cancelled: { masterId: string; recurrenceId: number }[] = [];
  for (const item of items) {
    if (item.eventType === "workingLocation") continue;
    if (item.status === "cancelled") {
      const original = googleTime(item.originalStartTime, calendarTz);
      if (item.recurringEventId && original) {
        cancelled.push({ masterId: item.recurringEventId, recurrenceId: original.ms });
      }
      continue;
    }
    const start = googleTime(item.start, calendarTz);
    if (!start) {
      warnings.add("Algún evento de Google no tenía fecha y se ha descartado");
      continue;
    }
    const uid = cleanUid(item.iCalUID ?? item.id, item.id);
    if (!item.recurringEventId) uidsById.set(item.id, uid);
    const birthday = item.eventType === "birthday";
    const allDay = birthday || start.allDay;
    const endAt = birthday
      ? start.ms + DAY_MS
      : fixRange(start.ms, googleTime(item.end, start.tz)?.ms ?? null, allDay, warnings);

    let rrule: string | null = null;
    const exdates: number[] = [];
    if (!birthday && !item.recurringEventId) {
      for (const line of item.recurrence ?? []) {
        const upper = line.toUpperCase();
        if (upper.startsWith("RRULE:") && rrule === null) {
          rrule = convertRrule(line.slice(6), { allDay, tz: start.tz }, warnings);
        } else if (upper.startsWith("EXDATE")) {
          exdates.push(...parseExdateLine(line, allDay, start.tz));
        } else if (upper.startsWith("RDATE")) {
          warnings.add("Las fechas sueltas de repetición (RDATE) no se admiten y se han ignorado");
        }
      }
    }
    const original = item.recurringEventId ? googleTime(item.originalStartTime, start.tz) : null;
    const reminders = item.reminders?.useDefault
      ? meta.defaultReminders
      : (item.reminders?.overrides ?? [])
          .map((r) => r.minutes)
          .filter((m): m is number => typeof m === "number");
    const date = new Date(start.ms);
    events.push({
      uid,
      recurrenceId: original?.ms ?? null,
      type: birthday ? "birthday" : "event",
      title: cleanTitle(item.summary),
      notes: cleanText(item.description, EVENT_LIMITS.notes),
      location: cleanText(item.location, EVENT_LIMITS.location),
      url: null,
      allDay,
      startAt: start.ms,
      endAt,
      tz: start.tz,
      rrule: rrule ?? null,
      exdates: rrule ? [...new Set(exdates)] : [],
      reminders: cleanReminders(reminders, warnings),
      feb29Rule: birthday && date.getUTCMonth() === 1 && date.getUTCDate() === 29 ? "feb28" : null,
    });
  }
  return { events, cancelled };
}

/** Descarga y convierte un calendario entero de la cuenta. */
export async function downloadCalendar(
  client: GoogleCalendarClient,
  meta: CalendarMeta,
  options: { defaultTimeZone: string; maxEvents: number },
): Promise<{ events: ImportedEvent[]; warnings: Warnings }> {
  const warnings = new Warnings();
  const uidsById = new Map<string, string>();
  const events: ImportedEvent[] = [];
  const cancelled: { masterId: string; recurrenceId: number }[] = [];
  for await (const page of client.events(meta.id)) {
    const converted = convertGoogleEvents(page, meta, options.defaultTimeZone, uidsById, warnings);
    events.push(...converted.events);
    cancelled.push(...converted.cancelled);
    if (events.length > options.maxEvents) {
      throw new ImportLimitError(
        `Demasiados eventos; el máximo por importación es ${String(IMPORT_LIMITS.events)}`,
      );
    }
  }
  const resolved = cancelled.flatMap(({ masterId, recurrenceId }) => {
    const uid = uidsById.get(masterId);
    return uid ? [{ uid, recurrenceId }] : [];
  });
  return { events: finalizeEvents(events, resolved, warnings), warnings };
}
