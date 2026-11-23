import type { CalendarInfo, GoogleSyncInfo } from "@delyra/shared";
import { env, exports } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDb } from "../src/db/client";
import { auditLog, googleConnections } from "../src/db/schema";
import { keyringFromEnv } from "../src/lib/field-crypto";
import { createLogger } from "../src/lib/logger";
import {
  type GoogleEvent,
  googleConfig,
  GoogleRevokedError,
  OAUTH_COOKIE,
} from "../src/services/google";
import { googleSyncRepository } from "../src/repositories/google-sync";
import { syncDueGoogleCalendars, syncGoogleCalendar } from "../src/services/google-sync";
import { registerUser, type TestClient } from "./helpers";

/** Sincronización continua de Google a Delyra (F7-09, ADR-0014). */

vi.setConfig({ testTimeout: 30_000 });

const ACCESS = "acceso-inicial";
const ACCESS_RENEWED = "acceso-renovado";
const REFRESH = "1//token-de-actualizacion-secreto";

const PRIMARY = {
  id: "persona@gmail.com",
  summary: "persona@gmail.com",
  summaryOverride: "Mi calendario",
  backgroundColor: "#9FE1E7",
  timeZone: "Europe/Madrid",
  accessRole: "owner",
  primary: true,
  defaultReminders: [{ method: "popup", minutes: 30 }],
};
const HOLIDAYS = {
  id: "es.spain#holiday@group.v.calendar.google.com",
  summary: "Festivos en España",
  backgroundColor: "#16a765",
  accessRole: "reader",
};

function event(id: string, summary: string, day: string): GoogleEvent {
  return {
    id,
    iCalUID: `${id}@google.com`,
    status: "confirmed",
    summary,
    start: { dateTime: `${day}T10:00:00+01:00`, timeZone: "Europe/Madrid" },
    end: { dateTime: `${day}T11:00:00+01:00`, timeZone: "Europe/Madrid" },
    reminders: { useDefault: true },
  };
}

/** Estado de la cuenta de Google simulada. */
interface FakeGoogle {
  events: GoogleEvent[];
  /** Cambios pendientes que verá la próxima consulta incremental. */
  changes: number;
  /** El `syncToken` ya no vale (410). */
  gone: boolean;
  /** Sin `refresh_token` en el canje del código. */
  noRefresh: boolean;
  /** Google retiró el permiso: el token de acceso da 401 y el de actualización, invalid_grant. */
  revoked: boolean;
  calls: { token: URLSearchParams[]; revoke: string[]; api: string[] };
}

function fakeGoogle(): FakeGoogle {
  const state: FakeGoogle = {
    events: [event("a", "Dentista", "2026-12-01"), event("b", "Cena", "2026-12-02")],
    changes: 0,
    gone: false,
    noRefresh: false,
    revoked: false,
    calls: { token: [], revoke: [], api: [] },
  };
  let syncCounter = 0;
  const original = globalThis.fetch.bind(globalThis);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    if (url.href === "https://oauth2.googleapis.com/token") {
      const body = new URLSearchParams(init?.body as string);
      state.calls.token.push(body);
      if (body.get("grant_type") === "refresh_token") {
        expect(body.get("refresh_token")).toBe(REFRESH);
        if (state.revoked) return Response.json({ error: "invalid_grant" }, { status: 400 });
        return Response.json({ access_token: ACCESS_RENEWED, expires_in: 3599 });
      }
      return Response.json({
        access_token: ACCESS,
        ...(state.noRefresh ? {} : { refresh_token: REFRESH }),
        expires_in: 3599,
        scope: "https://www.googleapis.com/auth/calendar.readonly",
      });
    }
    if (url.href === "https://oauth2.googleapis.com/revoke") {
      state.calls.revoke.push(new URLSearchParams(init?.body as string).get("token") ?? "");
      return new Response(null, { status: 200 });
    }
    if (url.hostname === "www.googleapis.com") {
      const sync = url.searchParams.get("syncToken");
      state.calls.api.push(`${decodeURIComponent(url.pathname)}${sync ? `?sync=${sync}` : ""}`);
      const auth = new Headers(init?.headers).get("authorization");
      const valid = state.revoked ? [] : [`Bearer ${ACCESS}`, `Bearer ${ACCESS_RENEWED}`];
      if (!valid.includes(auth ?? "")) return Response.json({}, { status: 401 });
      if (url.pathname === "/calendar/v3/users/me/calendarList") {
        return Response.json({ items: [PRIMARY, HOLIDAYS] });
      }
      const listPrefix = "/calendar/v3/users/me/calendarList/";
      if (url.pathname.startsWith(listPrefix)) {
        const id = decodeURIComponent(url.pathname.slice(listPrefix.length));
        const found = [PRIMARY, HOLIDAYS].find((c) => c.id === id);
        return found ? Response.json(found) : Response.json({}, { status: 404 });
      }
      if (url.pathname === `/calendar/v3/calendars/${encodeURIComponent(PRIMARY.id)}/events`) {
        if (sync) {
          if (state.gone) return Response.json({}, { status: 410 });
          const items = Array.from({ length: state.changes }, (_, i) => ({ id: `c${String(i)}` }));
          state.changes = 0;
          return Response.json({ items, nextSyncToken: `sync-${String(++syncCounter)}` });
        }
        state.gone = false;
        return Response.json({
          items: state.events,
          nextSyncToken: `sync-${String(++syncCounter)}`,
        });
      }
      return Response.json({}, { status: 404 });
    }
    return original(input, init);
  });
  return state;
}

afterEach(() => {
  vi.restoreAllMocks();
});

function callback(client: TestClient, query: string, cookie: string) {
  return exports.default.fetch(
    new Request(`https://delyra.test/api/google/callback?${query}`, {
      headers: {
        "cf-connecting-ip": client.ip,
        Cookie: `__Secure-sid=${client.cookie ?? ""}; ${OAUTH_COOKIE}=${cookie}`,
      },
      redirect: "manual",
    }),
  );
}

/** Autoriza la sincronización y vuelve de Google con un código. Devuelve la redirección. */
async function connect(client: TestClient) {
  const response = await client.post("/api/google/sync/authorize");
  expect(response.status).toBe(200);
  const { url } = await response.json<{ url: string }>();
  const cookie = /__Secure-delyra-google=([^;]+)/.exec(
    response.headers.get("set-cookie") ?? "",
  )?.[1];
  const state = new URL(url).searchParams.get("state") ?? "";
  const back = await callback(client, `code=codigo&state=${state}`, cookie ?? "");
  expect(back.status).toBe(302);
  return { authorizeUrl: new URL(url), location: back.headers.get("location") ?? "" };
}

async function info(client: TestClient): Promise<GoogleSyncInfo> {
  return (await client.get("/api/google/sync")).json<GoogleSyncInfo>();
}

/** La primera descarga va en segundo plano: espera a que termine. */
async function waitSynced(client: TestClient): Promise<GoogleSyncInfo> {
  for (let i = 0; i < 50; i++) {
    const current = await info(client);
    if (current.calendars.every((c) => c.status !== "pending")) return current;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("La primera sincronización no terminó");
}

async function runScheduler(minutesLater: number) {
  return syncDueGoogleCalendars(
    createDb(env.DB),
    await keyringFromEnv(env),
    googleConfig(env),
    Date.now() + minutesLater * 60_000,
    createLogger({ test: "google-sync" }),
    50,
  );
}

async function connectAndSync(client: TestClient) {
  await connect(client);
  const added = await client.post("/api/google/sync/calendars", {
    googleCalendarId: PRIMARY.id,
  });
  expect(added.status).toBe(201);
  return waitSynced(client);
}

describe("conexión para sincronizar", () => {
  it("pide acceso permanente y guarda el token solo cifrado", async () => {
    const google = fakeGoogle();
    const { client } = await registerUser();
    expect(await info(client)).toEqual({ enabled: true, connection: null, calendars: [] });

    const { authorizeUrl, location } = await connect(client);
    expect(authorizeUrl.searchParams.get("access_type")).toBe("offline");
    expect(authorizeUrl.searchParams.get("prompt")).toContain("consent");
    expect(authorizeUrl.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/calendar.readonly",
    );
    expect(location).toBe("/importar?google=conectada#sincronizar");
    expect(google.calls.token).toHaveLength(1);

    const current = await info(client);
    expect(current.connection).toMatchObject({ email: PRIMARY.id, status: "ok" });
    expect(JSON.stringify(current)).not.toContain(REFRESH);

    const me = await (await client.get("/api/auth/me")).json<{ user: { id: string } }>();
    const db = createDb(env.DB);
    const [row] = await db
      .select()
      .from(googleConnections)
      .where(eq(googleConnections.ownerId, me.user.id));
    expect(row?.refreshTokenEnc).toMatch(/^v1:/);
    expect(row?.refreshTokenEnc).not.toContain(REFRESH);
    expect(row?.accessTokenEnc).not.toContain(ACCESS);
    const events = await db.select().from(auditLog).where(eq(auditLog.userId, me.user.id));
    expect(events.map((e) => e.event)).toContain("google.connected");

    // Los calendarios de la cuenta, con los festivos de Google desaconsejados.
    const available = await (
      await client.get("/api/google/sync/available")
    ).json<{
      calendars: { googleCalendarId: string; suggestSkip: boolean; synced: boolean }[];
    }>();
    expect(available.calendars).toEqual([
      expect.objectContaining({ googleCalendarId: PRIMARY.id, suggestSkip: false, synced: false }),
      expect.objectContaining({ googleCalendarId: HOLIDAYS.id, suggestSkip: true, synced: false }),
    ]);
  });

  it("sin token de actualización no se conecta", async () => {
    const google = fakeGoogle();
    google.noRefresh = true;
    const { client } = await registerUser();
    const { location } = await connect(client);
    expect(location).toBe("/importar?google=offline-denied#sincronizar");
    expect((await info(client)).connection).toBeNull();
  });

  it("sin conexión no se pueden listar ni añadir calendarios", async () => {
    fakeGoogle();
    const { client } = await registerUser();
    expect((await client.get("/api/google/sync/available")).status).toBe(409);
    expect(
      (await client.post("/api/google/sync/calendars", { googleCalendarId: PRIMARY.id })).status,
    ).toBe(409);
  });
});

describe("sincronización", () => {
  it("refleja el calendario, no toca nada si no hay cambios y se pone al día si los hay", async () => {
    const google = fakeGoogle();
    const { client } = await registerUser();
    const first = await connectAndSync(client);
    expect(first.calendars).toEqual([
      expect.objectContaining({
        name: "Mi calendario",
        color: "#9fe1e7",
        reminders: true,
        status: "ok",
        events: 2,
      }),
    ]);
    const calendars = await (
      await client.get("/api/calendars")
    ).json<{
      calendars: CalendarInfo[];
    }>();
    const mirrored = calendars.calendars.find((c) => c.id === first.calendars[0]?.calendarId);
    expect(mirrored?.readOnly).toBe(true);

    // Sin cambios: solo la consulta incremental, sin volver a descargar.
    google.calls.api.length = 0;
    expect(await runScheduler(16)).toBeGreaterThanOrEqual(1);
    expect(google.calls.api.filter((c) => c.includes(PRIMARY.id))).toEqual([
      `/calendar/v3/calendars/${PRIMARY.id}/events?sync=sync-1`,
    ]);

    // Cambios en Google: uno borrado, otro nuevo.
    google.events = [event("b", "Cena con Ana", "2026-12-02"), event("c", "Viaje", "2026-12-20")];
    google.changes = 2;
    await runScheduler(32);
    const after = await info(client);
    expect(after.calendars[0]).toMatchObject({ status: "ok", events: 2 });
    const occurrences = await (
      await client.get(
        `/api/events?from=2026-12-01T00:00:00Z&to=2027-01-01T00:00:00Z&calendars=${after.calendars[0]?.calendarId ?? ""}`,
      )
    ).json<{ events: { title: string }[] }>();
    expect(occurrences.events.map((e) => e.title).sort()).toEqual(["Cena con Ana", "Viaje"]);

    // Los eventos sincronizados son de solo lectura.
    const blocked = await client.post("/api/events", {
      calendarId: after.calendars[0]?.calendarId,
      title: "Nuevo",
      allDay: false,
      start: "2026-12-05T10:00:00.000Z",
      end: "2026-12-05T11:00:00.000Z",
      tz: "Europe/Madrid",
    });
    expect([403, 409, 422]).toContain(blocked.status);

    // syncToken caducado (410): se vuelve a descargar entero.
    google.gone = true;
    google.calls.api.length = 0;
    await runScheduler(48);
    expect(google.calls.api.some((c) => c === `/calendar/v3/calendars/${PRIMARY.id}/events`)).toBe(
      true,
    );
    expect((await info(client)).calendars[0]?.status).toBe("ok");
  });

  it("si Google retira el permiso, la conexión queda revocada hasta reconectar", async () => {
    const google = fakeGoogle();
    const { client } = await registerUser();
    await connectAndSync(client);

    google.revoked = true;
    await runScheduler(16);
    const revoked = await info(client);
    expect(revoked.connection?.status).toBe("revoked");
    expect(revoked.calendars[0]).toMatchObject({
      status: "error",
      error: "Google ha retirado el permiso de Delyra. Vuelve a conectar tu cuenta.",
    });

    // Mientras siga revocada no se vuelve a llamar a Google.
    const me = await (await client.get("/api/auth/me")).json<{ user: { id: string } }>();
    const db = createDb(env.DB);
    const [row] = await googleSyncRepository(db, me.user.id).calendars();
    const config = googleConfig(env);
    if (!row || !config) throw new Error("falta la fila o la configuración");
    const calls = google.calls.token.length + google.calls.api.length;
    await expect(
      syncGoogleCalendar(db, await keyringFromEnv(env), config, row, Date.now() + 26 * 3_600_000),
    ).rejects.toThrow(GoogleRevokedError);
    expect(google.calls.token.length + google.calls.api.length).toBe(calls);
    expect((await client.get("/api/google/sync/available")).status).toBe(409);

    // Reconectar lo pone todo al día.
    google.revoked = false;
    await connect(client);
    expect((await info(client)).connection?.status).toBe("ok");
    await runScheduler(1);
    expect((await info(client)).calendars[0]?.status).toBe("ok");
  });

  it("controla duplicados, calendarios ajenos y la sincronización manual", async () => {
    fakeGoogle();
    const owner = await registerUser();
    const other = await registerUser();
    const synced = await connectAndSync(owner.client);
    const id = synced.calendars[0]?.id ?? "";

    expect(
      (await owner.client.post("/api/google/sync/calendars", { googleCalendarId: PRIMARY.id }))
        .status,
    ).toBe(409);
    expect(
      (
        await owner.client.post("/api/google/sync/calendars", {
          googleCalendarId: "otro@gmail.com",
        })
      ).status,
    ).toBe(404);
    // Recién sincronizado: hay que esperar para forzarlo a mano.
    expect((await owner.client.post(`/api/google/sync/calendars/${id}/sync`)).status).toBe(429);
    // Lo de otra persona responde como inexistente.
    expect((await other.client.post(`/api/google/sync/calendars/${id}/sync`)).status).toBe(404);
    expect((await other.client.delete(`/api/google/sync/calendars/${id}`)).status).toBe(404);

    expect((await owner.client.delete(`/api/google/sync/calendars/${id}`)).status).toBe(204);
    const after = await info(owner.client);
    expect(after.calendars).toEqual([]);
    const calendars = await (
      await owner.client.get("/api/calendars")
    ).json<{
      calendars: CalendarInfo[];
    }>();
    expect(calendars.calendars.some((c) => c.id === synced.calendars[0]?.calendarId)).toBe(false);
  });

  it("desconectar revoca el permiso en Google y borra lo sincronizado", async () => {
    const google = fakeGoogle();
    const { client } = await registerUser();
    const synced = await connectAndSync(client);
    expect((await client.delete("/api/google/sync")).status).toBe(204);
    expect(google.calls.revoke).toEqual([REFRESH]);
    expect(await info(client)).toEqual({ enabled: true, connection: null, calendars: [] });
    const calendars = await (
      await client.get("/api/calendars")
    ).json<{
      calendars: CalendarInfo[];
    }>();
    expect(calendars.calendars.some((c) => c.id === synced.calendars[0]?.calendarId)).toBe(false);
    expect((await client.delete("/api/google/sync")).status).toBe(404);
  });
});
