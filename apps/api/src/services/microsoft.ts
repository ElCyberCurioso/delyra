import { APP_ORIGINS, type AppEnvironment, appEnvironmentSchema } from "@delyra/shared";
import { randomToken, sha256Base64Url } from "../lib/crypto";
import { decryptField, encryptField, type Keyring } from "../lib/field-crypto";

/**
 * Microsoft 365 (docs/plan-teams.md, ADR-0015): OAuth 2.0 con PKCE contra Microsoft Entra ID y
 * lectura del calendario con Microsoft Graph.
 *
 * - Permisos delegados `offline_access`, `User.Read` y `Calendars.Read` (solo lectura).
 * - El token de actualización rota: cada renovación devuelve uno nuevo que hay que guardar.
 * - De cada evento solo se piden asunto, horario, lugar, organizador y enlace de Teams; nunca el
 *   cuerpo de la reunión.
 * - Los enlaces de paginación (`@odata.nextLink`) solo se siguen si son de `graph.microsoft.com`.
 */

export const MICROSOFT_SCOPES = "offline_access User.Read Calendars.Read";
export const MICROSOFT_OAUTH_COOKIE = "__Secure-delyra-microsoft";
export const MICROSOFT_OAUTH_TTL_MS = 10 * 60_000;
export const GRAPH = "https://graph.microsoft.com/v1.0";
const STATE_AAD = "microsoft-oauth-state";
/** Como mucho tantos eventos por volcado (unas semanas de calendario). */
const MAX_EVENTS = 1000;

export interface MicrosoftConfig {
  clientId: string;
  clientSecret: string;
  tenant: string;
  redirectUri: string;
}

export function microsoftConfig(env: {
  APP_ENV: string;
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
  MICROSOFT_TENANT_ID?: string;
}): MicrosoftConfig | null {
  if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET) return null;
  const environment: AppEnvironment = appEnvironmentSchema.parse(env.APP_ENV);
  const tenant = env.MICROSOFT_TENANT_ID?.trim() ?? "";
  return {
    clientId: env.MICROSOFT_CLIENT_ID,
    clientSecret: env.MICROSOFT_CLIENT_SECRET,
    // Solo un GUID o los alias de Microsoft: nunca texto libre en la URL de autorización.
    tenant: /^([0-9a-f-]{36}|common|organizations|consumers)$/i.test(tenant) ? tenant : "common",
    // El login y los ajustes del tablero están en la app de trabajo.
    redirectUri: `${APP_ORIGINS[environment].work}/api/microsoft/callback`,
  };
}

const authority = (config: MicrosoftConfig) =>
  `https://login.microsoftonline.com/${config.tenant}/oauth2/v2.0`;

// ── OAuth ────────────────────────────────────────────────────────────────────

export interface MicrosoftOAuthState {
  state: string;
  verifier: string;
  userId: string;
  /** Tablero al que volver (y que se va a configurar). */
  boardId: string;
  expiresAt: number;
}

export function newMicrosoftState(userId: string, boardId: string, now: number) {
  return {
    state: randomToken(32),
    verifier: randomToken(48),
    userId,
    boardId,
    expiresAt: now + MICROSOFT_OAUTH_TTL_MS,
  } satisfies MicrosoftOAuthState;
}

export async function sealMicrosoftState(state: MicrosoftOAuthState, keyring: Keyring) {
  return encryptField(JSON.stringify(state), keyring, STATE_AAD);
}

export async function openMicrosoftState(
  value: string,
  keyring: Keyring,
): Promise<MicrosoftOAuthState | null> {
  try {
    const parsed = JSON.parse(
      await decryptField(value, keyring, STATE_AAD),
    ) as Partial<MicrosoftOAuthState>;
    if (
      typeof parsed.state === "string" &&
      typeof parsed.verifier === "string" &&
      typeof parsed.userId === "string" &&
      typeof parsed.boardId === "string" &&
      typeof parsed.expiresAt === "number"
    ) {
      return {
        state: parsed.state,
        verifier: parsed.verifier,
        userId: parsed.userId,
        boardId: parsed.boardId,
        expiresAt: parsed.expiresAt,
      };
    }
  } catch {
    // Cookie manipulada o cifrada con otra clave.
  }
  return null;
}

export async function microsoftAuthorizeUrl(
  config: MicrosoftConfig,
  state: MicrosoftOAuthState,
): Promise<string> {
  const url = new URL(`${authority(config)}/authorize`);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: config.redirectUri,
    response_mode: "query",
    scope: MICROSOFT_SCOPES,
    state: state.state,
    code_challenge: await sha256Base64Url(state.verifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return url.href;
}

export class MicrosoftAuthError extends Error {
  override name = "MicrosoftAuthError";
}

/** Microsoft ha retirado el permiso (o caducó): hay que volver a conectar. */
export class MicrosoftRevokedError extends Error {
  override name = "MicrosoftRevokedError";
  constructor() {
    super("Microsoft ha retirado el permiso de Delyra. Vuelve a conectar tu cuenta.");
  }
}

export class GraphError extends Error {
  override name = "GraphError";
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface MicrosoftTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

function grantsCalendarRead(scope: unknown): boolean {
  return (
    typeof scope === "string" &&
    scope.split(" ").some((s) => /(^|\/)calendars\.read(write)?$/i.test(s))
  );
}

async function tokenRequest(
  config: MicrosoftConfig,
  params: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<MicrosoftTokens> {
  const response = await fetchImpl(`${authority(config)}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: MICROSOFT_SCOPES,
      ...params,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json<{
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
    scope?: unknown;
    error?: unknown;
  }>();
  if (!response.ok) {
    if (params.grant_type === "refresh_token" && body.error === "invalid_grant") {
      throw new MicrosoftRevokedError();
    }
    throw new MicrosoftAuthError(`Microsoft rechazó la petición (${String(response.status)})`);
  }
  if (
    typeof body.access_token !== "string" ||
    body.access_token.length > 8192 ||
    typeof body.refresh_token !== "string" ||
    body.refresh_token.length > 8192
  ) {
    throw new MicrosoftAuthError("Respuesta de Microsoft sin tokens");
  }
  if (!grantsCalendarRead(body.scope)) {
    throw new MicrosoftAuthError("No se concedió acceso de lectura al calendario");
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresIn: typeof body.expires_in === "number" ? body.expires_in : 3600,
  };
}

export function exchangeMicrosoftCode(
  config: MicrosoftConfig,
  code: string,
  verifier: string,
  fetchImpl: typeof fetch = fetch,
) {
  return tokenRequest(
    config,
    {
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      code_verifier: verifier,
    },
    fetchImpl,
  );
}

export function refreshMicrosoftToken(
  config: MicrosoftConfig,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
) {
  return tokenRequest(
    config,
    { grant_type: "refresh_token", refresh_token: refreshToken },
    fetchImpl,
  );
}

export const microsoftRefreshAad = (ownerId: string, id: string) =>
  `microsoft-refresh:${ownerId}:${id}`;
export const microsoftAccessAad = (ownerId: string, id: string) =>
  `microsoft-access:${ownerId}:${id}`;

// ── Graph ────────────────────────────────────────────────────────────────────

interface GraphTime {
  dateTime?: string;
  timeZone?: string;
}

export interface GraphEvent {
  id: string;
  subject?: string | null;
  start?: GraphTime;
  end?: GraphTime;
  isAllDay?: boolean;
  isCancelled?: boolean;
  isOnlineMeeting?: boolean;
  onlineMeeting?: { joinUrl?: string | null } | null;
  location?: { displayName?: string | null } | null;
  organizer?: { emailAddress?: { name?: string | null } } | null;
}

const EVENT_SELECT =
  "id,subject,start,end,isAllDay,isCancelled,isOnlineMeeting,onlineMeeting,location,organizer";

/** Un 401 de Graph: el token de acceso ya no vale. */
export class GraphUnauthorizedError extends GraphError {
  override name = "GraphUnauthorizedError";
}

export class GraphClient {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async get<T>(url: URL): Promise<T> {
    if (url.origin !== "https://graph.microsoft.com") {
      throw new GraphError(502, "Enlace de Microsoft Graph no válido");
    }
    const response = await this.fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
        // Horas en UTC: así se guardan como instantes sin depender de la zona del calendario.
        Prefer: 'outlook.timezone="UTC"',
      },
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 401) throw new GraphUnauthorizedError(401, "Token no válido");
    if (!response.ok) {
      throw new GraphError(response.status, `Microsoft Graph respondió ${String(response.status)}`);
    }
    return response.json<T>();
  }

  /** Cuenta conectada (para mostrarla). */
  async me(): Promise<string | null> {
    const url = new URL(`${GRAPH}/me`);
    url.searchParams.set("$select", "mail,userPrincipalName");
    const me = await this.get<{ mail?: string | null; userPrincipalName?: string | null }>(url);
    const email = me.mail ?? me.userPrincipalName ?? null;
    return email && email.length <= 254 ? email : null;
  }

  /** Eventos (con las repeticiones ya expandidas) entre dos instantes. */
  async calendarView(from: Date, to: Date): Promise<GraphEvent[]> {
    let url: URL | null = new URL(`${GRAPH}/me/calendarView`);
    url.search = new URLSearchParams({
      startDateTime: from.toISOString(),
      endDateTime: to.toISOString(),
      $select: EVENT_SELECT,
      $orderby: "start/dateTime",
      $top: "200",
    }).toString();
    const events: GraphEvent[] = [];
    while (url && events.length < MAX_EVENTS) {
      const page: { value?: GraphEvent[]; "@odata.nextLink"?: string } = await this.get(url);
      events.push(...(page.value ?? []));
      url = page["@odata.nextLink"] ? new URL(page["@odata.nextLink"]) : null;
    }
    return events.slice(0, MAX_EVENTS);
  }

  /** Un evento por su id; null si ya no existe. */
  async event(id: string): Promise<GraphEvent | null> {
    const url = new URL(`${GRAPH}/me/events/${encodeURIComponent(id)}`);
    url.searchParams.set("$select", EVENT_SELECT);
    try {
      return await this.get<GraphEvent>(url);
    } catch (error) {
      if (error instanceof GraphError && error.status === 404) return null;
      throw error;
    }
  }
}

// ── Conversión ───────────────────────────────────────────────────────────────

export interface MeetingInfo {
  eventId: string;
  title: string;
  allDay: boolean;
  /** Inicio: instante UTC o, si es de día completo, la fecha `AAAA-MM-DD`. */
  startAt: number;
  startDate: string | null;
  endAt: number | null;
  cancelled: boolean;
  /** Enlace de Teams, solo si es de Microsoft (`https`). */
  joinUrl: string | null;
  location: string | null;
  organizer: string | null;
}

function graphInstant(time: GraphTime | undefined): number | null {
  if (!time?.dateTime) return null;
  // Con `outlook.timezone="UTC"` llega sin zona: «2026-11-24T10:00:00.0000000».
  const iso = /[zZ]|[+-]\d\d:\d\d$/.test(time.dateTime) ? time.dateTime : `${time.dateTime}Z`;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

const TEAMS_HOSTS = new Set(["teams.microsoft.com", "teams.live.com"]);

export function teamsJoinUrl(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 2048) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && TEAMS_HOSTS.has(url.hostname) ? url.href : null;
  } catch {
    return null;
  }
}

/** Texto plano de una línea y con un tamaño máximo (los nombres vienen de terceros). */
function plain(value: string | null | undefined, max: number): string | null {
  // eslint-disable-next-line no-control-regex -- quitar caracteres de control es justo lo que se busca
  const text = value?.replace(/[\u0000-\u001f\u007f]+/g, " ").trim() ?? "";
  return text ? text.slice(0, max) : null;
}

export function meetingInfo(event: GraphEvent): MeetingInfo | null {
  const startAt = graphInstant(event.start);
  if (startAt === null || typeof event.id !== "string" || event.id.length > 512) return null;
  const allDay = event.isAllDay === true;
  return {
    eventId: event.id,
    // Sin asunto: el texto por defecto lo pone quien crea la tarjeta, en el idioma de la cuenta.
    title: plain(event.subject, 300) ?? "",
    allDay,
    startAt,
    startDate: allDay ? new Date(startAt).toISOString().slice(0, 10) : null,
    endAt: graphInstant(event.end),
    cancelled: event.isCancelled === true,
    joinUrl: teamsJoinUrl(event.onlineMeeting?.joinUrl),
    location: plain(event.location?.displayName, 200),
    organizer: plain(event.organizer?.emailAddress?.name, 120),
  };
}

/** Escapa lo que Markdown interpretaría en textos que vienen de fuera. */
export function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_{}[\]()#+\-.!|<>~])/g, "\\$1");
}
