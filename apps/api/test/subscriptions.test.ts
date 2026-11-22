import type { CalendarInfo, EventDetail, Occurrence, SubscriptionInfo } from "@delyra/shared";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDb } from "../src/db/client";
import { calendarSubscriptions } from "../src/db/schema";
import { keyringFromEnv } from "../src/lib/field-crypto";
import { createLogger } from "../src/lib/logger";
import { syncDueSubscriptions } from "../src/services/subscriptions";
import { calendarHeader, crlf, GOOGLE_EXPORT } from "./fixtures/ics";
import { registerUser, type TestClient } from "./helpers";

/** Suscripción a la dirección iCal secreta (F5-06, F5-07): SSRF, caché y solo lectura. */

const FEED =
  "https://calendar.google.com/calendar/ical/persona%40gmail.com/private-0123456789abcdef/basic.ics";

interface FeedState {
  body: string;
  etag: string;
  status?: number;
  location?: string;
}

/** Simula calendar.google.com; registra las peticiones (y cualquier otro host al que se llame). */
function fakeFeed(state: FeedState) {
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const original = globalThis.fetch.bind(globalThis);
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith("https://calendar.google.com/")) {
      if (url.startsWith("https://delyra.test/")) return original(input, init);
      requests.push({ url, init });
      return Promise.resolve(new Response("no", { status: 500 }));
    }
    requests.push({ url, init });
    if (state.status && state.status !== 200) {
      return Promise.resolve(
        new Response(null, {
          status: state.status,
          headers: state.location ? { location: state.location } : {},
        }),
      );
    }
    const etag = new Headers(init?.headers).get("if-none-match");
    if (etag === state.etag) return Promise.resolve(new Response(null, { status: 304 }));
    return Promise.resolve(
      new Response(state.body, { headers: { "content-type": "text/calendar", etag: state.etag } }),
    );
  });
  return requests;
}

afterEach(() => {
  vi.restoreAllMocks();
});

async function subscribe(client: TestClient, url = FEED) {
  return client.post("/api/subscriptions", { url });
}

async function list(client: TestClient) {
  return (
    await (await client.get("/api/subscriptions")).json<{ subscriptions: SubscriptionInfo[] }>()
  ).subscriptions;
}

async function occurrences(client: TestClient, calendarId: string) {
  const response = await client.get(
    `/api/events?from=2026-11-01T00:00:00Z&to=2027-01-01T00:00:00Z&calendars=${calendarId}`,
  );
  return (await response.json<{ events: Occurrence[] }>()).events;
}

describe("dirección de la suscripción (SSRF)", () => {
  it("solo admite https://calendar.google.com/calendar/ical/….ics", async () => {
    const requests = fakeFeed({ body: GOOGLE_EXPORT, etag: '"v1"' });
    const { client } = await registerUser();
    for (const url of [
      FEED.replace("https:", "http:"),
      FEED.replace("calendar.google.com", "evil.example"),
      FEED.replace("calendar.google.com", "calendar.google.com.evil.example"),
      FEED.replace("calendar.google.com", "calendar.google.com:8443"),
      FEED.replace("https://", "https://usuario:clave@"),
      FEED.replace("https://calendar.google.com", "https://evil.example#@calendar.google.com"),
      "https://calendar.google.com/calendar/embed?src=persona",
      "https://calendar.google.com/calendar/ical/../../redirect?u=//169.254.169.254/x.ics",
      "https://127.0.0.1/calendar/ical/x/basic.ics",
      "file:///etc/passwd",
    ]) {
      const response = await subscribe(client, url);
      expect(response.status, url).toBe(422);
    }
    expect(requests).toHaveLength(0);
  });

  it("no sigue redirecciones (podrían llevar a otro host)", async () => {
    const requests = fakeFeed({
      body: "",
      etag: "",
      status: 302,
      location: "http://169.254.169.254/latest/meta-data",
    });
    const { client } = await registerUser();
    const response = await subscribe(client);
    expect(response.status).toBe(422);
    expect(JSON.stringify(await response.json())).toContain("redirige");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.init?.redirect).toBe("manual");
  });

  it("una respuesta que no es un calendario se rechaza", async () => {
    fakeFeed({ body: "<html>Inicia sesión</html>", etag: '"x"' });
    const { client } = await registerUser();
    expect((await subscribe(client)).status).toBe(422);
    expect(await list(client)).toHaveLength(0);
  });
});

describe("suscripción y sincronización", () => {
  it("crea un calendario de solo lectura sin devolver nunca la dirección secreta", async () => {
    fakeFeed({ body: GOOGLE_EXPORT, etag: '"v1"' });
    const { client } = await registerUser();
    const response = await subscribe(client);
    expect(response.status).toBe(201);
    const { subscription } = await response.json<{ subscription: SubscriptionInfo }>();
    expect(subscription).toMatchObject({ name: "Personal", status: "ok", events: 4 });
    expect(subscription.urlHint).toBe("calendar.google.com/calendar/ical/pers…/basic.ics");
    expect(JSON.stringify(subscription)).not.toContain("private-0123456789abcdef");
    const [row] = await createDb(env.DB)
      .select()
      .from(calendarSubscriptions)
      .where(eq(calendarSubscriptions.id, subscription.id));
    expect(row?.urlEnc).not.toContain("private-0123456789abcdef");

    const calendar = (
      await (await client.get("/api/calendars")).json<{ calendars: CalendarInfo[] }>()
    ).calendars.find((c) => c.id === subscription.calendarId);
    expect(calendar?.readOnly).toBe(true);
    const events = await occurrences(client, subscription.calendarId);
    expect(events.some((e) => e.title === "Reunión semanal (movida)")).toBe(true);
  });

  it("sus eventos no se pueden crear, editar ni borrar", async () => {
    fakeFeed({ body: GOOGLE_EXPORT, etag: '"v1"' });
    const { client } = await registerUser();
    const { subscription } = await (
      await subscribe(client)
    ).json<{ subscription: SubscriptionInfo }>();
    const [event] = await occurrences(client, subscription.calendarId);
    const created = await client.post("/api/events", {
      calendarId: subscription.calendarId,
      title: "Nuevo",
      allDay: false,
      start: "2026-12-01T10:00:00Z",
      end: "2026-12-01T11:00:00Z",
      tz: "Europe/Madrid",
    });
    expect(created.status).toBe(422);
    const patched = await client.request("PATCH", `/api/events/${event?.eventId ?? ""}`, {
      title: "Cambiado",
    });
    expect(patched.status).toBe(409);
    expect((await client.delete(`/api/events/${event?.eventId ?? ""}`)).status).toBe(409);
    // Tampoco se puede mover un evento propio a la suscripción.
    const personal = (
      await (await client.get("/api/calendars")).json<{ calendars: CalendarInfo[] }>()
    ).calendars.find((c) => c.kind === "personal");
    const own = await client.post("/api/events", {
      calendarId: personal?.id,
      title: "Mío",
      allDay: false,
      start: "2026-12-01T10:00:00Z",
      end: "2026-12-01T11:00:00Z",
      tz: "Europe/Madrid",
    });
    const { event: mine } = await own.json<{ event: EventDetail }>();
    const moved = await client.request("PATCH", `/api/events/${mine.id}`, {
      calendarId: subscription.calendarId,
    });
    expect(moved.status).toBe(422);
  });

  it("cada hora: 304 si no hay cambios; si los hay, refleja el origen", async () => {
    const state: FeedState = { body: GOOGLE_EXPORT, etag: '"v1"' };
    const requests = fakeFeed(state);
    const { client } = await registerUser();
    const { subscription } = await (
      await subscribe(client)
    ).json<{ subscription: SubscriptionInfo }>();
    const db = createDb(env.DB);
    const keyring = await keyringFromEnv(env);
    const logger = createLogger({ test: "subscriptions" });
    const later = Date.now() + 61 * 60_000;

    // Sin cambios: petición condicional y 304.
    expect(await syncDueSubscriptions(db, keyring, later, logger, 50)).toBeGreaterThanOrEqual(1);
    expect(new Headers(requests.at(-1)?.init?.headers).get("if-none-match")).toBe('"v1"');

    // Google quita el dentista y cambia el título de las vacaciones.
    state.etag = '"v2"';
    state.body = GOOGLE_EXPORT.replace(
      "SUMMARY:Vacaciones",
      "SUMMARY:Vacaciones de Navidad",
    ).replace(/BEGIN:VEVENT\r\nDTSTART:20261125T170000Z[\s\S]*?END:VEVENT\r\n/, "");
    await syncDueSubscriptions(db, keyring, later + 61 * 60_000, logger, 50);
    const titles = (await occurrences(client, subscription.calendarId)).map((e) => e.title);
    expect(titles).toContain("Vacaciones de Navidad");
    expect(titles).not.toContain("Dentista");
    expect(titles).not.toContain("Vacaciones");
  });

  it("si Google deja de reconocer la dirección, queda en error con el motivo", async () => {
    const state: FeedState = { body: GOOGLE_EXPORT, etag: '"v1"' };
    fakeFeed(state);
    const { client } = await registerUser();
    const { subscription } = await (
      await subscribe(client)
    ).json<{ subscription: SubscriptionInfo }>();
    state.status = 404;
    const db = createDb(env.DB);
    await syncDueSubscriptions(
      db,
      await keyringFromEnv(env),
      Date.now() + 2 * 3_600_000,
      createLogger({}),
      50,
    );
    const [saved] = (await list(client)).filter((s) => s.id === subscription.id);
    expect(saved).toMatchObject({ status: "error" });
    expect(saved?.error).toContain("restablecido");
    // Los eventos que había se conservan hasta que vuelva a funcionar.
    expect(saved?.events).toBe(4);
  });

  it("«Sincronizar ahora» tiene un mínimo de 5 minutos", async () => {
    fakeFeed({ body: GOOGLE_EXPORT, etag: '"v1"' });
    const { client } = await registerUser();
    const { subscription } = await (
      await subscribe(client)
    ).json<{ subscription: SubscriptionInfo }>();
    expect((await client.post(`/api/subscriptions/${subscription.id}/sync`)).status).toBe(429);
  });

  it("otro usuario no la ve ni la toca; al quitarla se borra su calendario", async () => {
    fakeFeed({ body: GOOGLE_EXPORT, etag: '"v1"' });
    const alice = await registerUser();
    const bob = await registerUser();
    const { subscription } = await (
      await subscribe(alice.client)
    ).json<{
      subscription: SubscriptionInfo;
    }>();
    expect(await list(bob.client)).toHaveLength(0);
    expect((await bob.client.post(`/api/subscriptions/${subscription.id}/sync`)).status).toBe(404);
    expect((await bob.client.delete(`/api/subscriptions/${subscription.id}`)).status).toBe(404);

    expect((await alice.client.delete(`/api/subscriptions/${subscription.id}`)).status).toBe(204);
    expect(await list(alice.client)).toHaveLength(0);
    const calendars = (
      await (await alice.client.get("/api/calendars")).json<{ calendars: CalendarInfo[] }>()
    ).calendars;
    expect(calendars.some((c) => c.id === subscription.calendarId)).toBe(false);
  });

  it("un calendario enorme se rechaza", async () => {
    const lines = [...calendarHeader("Grande")];
    lines.push("X-RELLENO:" + "a".repeat(70), "END:VCALENDAR");
    const huge = crlf(lines)
      .repeat(1)
      .padEnd(26 * 1024 * 1024, " ");
    fakeFeed({ body: huge, etag: '"big"' });
    const { client } = await registerUser();
    const response = await subscribe(client);
    expect(response.status).toBe(422);
    expect(JSON.stringify(await response.json())).toContain("demasiado grande");
  });
});
