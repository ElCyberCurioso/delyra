import type { CalendarInfo, ImportInfo, Occurrence } from "@delyra/shared";
import { introspectWorkflow } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDb } from "../src/db/client";
import { imports } from "../src/db/schema";
import { sha256Base64Url } from "../src/lib/crypto";
import { type GoogleEvent, OAUTH_COOKIE } from "../src/services/google";
import { registerUser, type TestClient } from "./helpers";

/** OAuth con Google e importación por la API (F5-04, F5-05, F5-07). */

vi.setConfig({ testTimeout: 30_000 });

const ACCESS_TOKEN = "token-de-acceso-de-prueba";
const REFRESH_TOKEN = "1//refresh-que-nunca-se-guarda";

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
  timeZone: "Europe/Madrid",
  accessRole: "reader",
};

const PAGE_1: GoogleEvent[] = [
  {
    id: "serie1",
    iCalUID: "serie1@google.com",
    status: "confirmed",
    summary: "Clase de inglés",
    description: "Libro <b>unidad 3</b>",
    start: { dateTime: "2026-12-01T18:00:00+01:00", timeZone: "Europe/Madrid" },
    end: { dateTime: "2026-12-01T19:00:00+01:00", timeZone: "Europe/Madrid" },
    recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=4", "EXDATE;TZID=Europe/Madrid:20261208T180000"],
    reminders: { useDefault: true },
  },
  {
    id: "serie1_20261215T170000Z",
    iCalUID: "serie1@google.com",
    status: "confirmed",
    summary: "Clase de inglés (aula 2)",
    recurringEventId: "serie1",
    originalStartTime: { dateTime: "2026-12-15T18:00:00+01:00", timeZone: "Europe/Madrid" },
    start: { dateTime: "2026-12-15T18:30:00+01:00", timeZone: "Europe/Madrid" },
    end: { dateTime: "2026-12-15T19:30:00+01:00", timeZone: "Europe/Madrid" },
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 5 }] },
  },
];
const PAGE_2: GoogleEvent[] = [
  // Ocurrencia cancelada (con showDeleted=false Google la sigue mandando).
  {
    id: "serie1_20261222T170000Z",
    status: "cancelled",
    recurringEventId: "serie1",
    originalStartTime: { dateTime: "2026-12-22T18:00:00+01:00", timeZone: "Europe/Madrid" },
  },
  {
    id: "cumple",
    iCalUID: "cumple@google.com",
    status: "confirmed",
    eventType: "birthday",
    summary: "Cumpleaños de Ana",
    start: { date: "1990-12-10" },
    end: { date: "1990-12-11" },
    recurrence: ["RRULE:FREQ=YEARLY"],
    reminders: { useDefault: false, overrides: [] },
  },
  {
    id: "oficina",
    eventType: "workingLocation",
    summary: "Oficina",
    start: { date: "2026-12-02" },
    end: { date: "2026-12-03" },
  },
];

interface Calls {
  token: URLSearchParams[];
  api: string[];
}

/** Simula accounts.google.com, oauth2.googleapis.com y la API de Calendar. */
function fakeGoogle(options: { scope?: string; tokenStatus?: number } = {}) {
  const calls: Calls = { token: [], api: [] };
  const original = globalThis.fetch.bind(globalThis);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    if (url.href === "https://oauth2.googleapis.com/token") {
      calls.token.push(new URLSearchParams(init?.body as string));
      if (options.tokenStatus) return new Response("{}", { status: options.tokenStatus });
      return Response.json({
        access_token: ACCESS_TOKEN,
        refresh_token: REFRESH_TOKEN,
        expires_in: 3599,
        scope: options.scope ?? "https://www.googleapis.com/auth/calendar.readonly",
        token_type: "Bearer",
      });
    }
    if (url.hostname === "www.googleapis.com") {
      calls.api.push(`${url.pathname}?${url.searchParams.get("pageToken") ?? ""}`);
      const auth = new Headers(init?.headers).get("authorization");
      if (auth !== `Bearer ${ACCESS_TOKEN}`) return new Response("{}", { status: 401 });
      if (url.pathname === "/calendar/v3/users/me/calendarList") {
        return Response.json({ items: [PRIMARY, HOLIDAYS] });
      }
      if (url.pathname === `/calendar/v3/calendars/${encodeURIComponent(PRIMARY.id)}/events`) {
        expect(url.searchParams.get("singleEvents")).toBe("false");
        return url.searchParams.get("pageToken") === "p2"
          ? Response.json({ items: PAGE_2 })
          : Response.json({ items: PAGE_1, nextPageToken: "p2" });
      }
      return Response.json({
        items: [
          {
            id: "f1",
            iCalUID: "f1@google.com",
            summary: "Navidad",
            start: { date: "2026-12-25" },
            end: { date: "2026-12-26" },
          },
        ],
      });
    }
    return original(input, init);
  });
  return calls;
}

afterEach(() => {
  vi.restoreAllMocks();
});

async function authorize(client: TestClient) {
  const response = await client.post("/api/google/authorize");
  expect(response.status).toBe(200);
  const { url } = await response.json<{ url: string }>();
  const cookie = /__Secure-delyra-google=([^;]+)/.exec(
    response.headers.get("set-cookie") ?? "",
  )?.[1];
  return {
    url: new URL(url),
    cookie: cookie ?? "",
    setCookie: response.headers.get("set-cookie") ?? "",
  };
}

function callback(client: TestClient, query: string, cookie: string | null) {
  const cookies = [`__Secure-sid=${client.cookie ?? ""}`];
  if (cookie !== null) cookies.push(`${OAUTH_COOKIE}=${cookie}`);
  return exports.default.fetch(
    new Request(`https://delyra.test/api/google/callback?${query}`, {
      headers: { "cf-connecting-ip": client.ip, Cookie: cookies.join("; ") },
      redirect: "manual",
    }),
  );
}

async function runPhase(trigger: () => Promise<Response>) {
  const introspector = await introspectWorkflow(env.IMPORT_WORKFLOW);
  try {
    const response = await trigger();
    for (const instance of await introspector.get()) await instance.waitForStatus("complete");
    return response;
  } finally {
    await introspector.dispose();
  }
}

describe("autorización (F5-04)", () => {
  it("POST /authorize devuelve la URL de Google con PKCE y deja la cookie cifrada", async () => {
    const { client } = await registerUser();
    expect(await (await client.get("/api/google/status")).json()).toEqual({ enabled: true });
    const { url, cookie, setCookie } = await authorize(client);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "cliente-de-prueba.apps.googleusercontent.com",
      redirect_uri: "http://localhost:5173/api/google/callback",
      response_type: "code",
      scope: "https://www.googleapis.com/auth/calendar.readonly",
      access_type: "online",
      code_challenge_method: "S256",
    });
    expect(url.searchParams.get("state")?.length).toBeGreaterThanOrEqual(43);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\/api\/google\/callback/);
    // La cookie no deja ver ni el state ni el verifier.
    expect(cookie).not.toContain(url.searchParams.get("state") ?? "-");
  });

  it("sin sesión, /authorize responde 401 y el callback manda a iniciar sesión", async () => {
    const { client } = await registerUser();
    const anonymous = new (client.constructor as typeof TestClient)();
    expect((await anonymous.post("/api/google/authorize")).status).toBe(401);
    const response = await callback(anonymous, "code=x&state=y", null);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login?next=%2Fimportar");
  });

  it("rechaza un state manipulado, sin cookie, de otra cuenta o con la cookie alterada", async () => {
    const calls = fakeGoogle();
    const alice = await registerUser();
    const bob = await registerUser();
    const { url, cookie } = await authorize(alice.client);
    const state = url.searchParams.get("state") ?? "";
    const location = async (response: Promise<Response>) =>
      (await response).headers.get("location");

    expect(await location(callback(alice.client, `code=c&state=${state}x`, cookie))).toBe(
      "/importar?google=state",
    );
    expect(await location(callback(alice.client, `code=c&state=${state}`, null))).toBe(
      "/importar?google=state",
    );
    // La cookie de Alice en la sesión de Bob (login CSRF / fijación).
    expect(await location(callback(bob.client, `code=c&state=${state}`, cookie))).toBe(
      "/importar?google=state",
    );
    const tampered = `${cookie.slice(0, -4)}AAAA`;
    expect(await location(callback(alice.client, `code=c&state=${state}`, tampered))).toBe(
      "/importar?google=state",
    );
    // Nunca se llegó a canjear ningún código.
    expect(calls.token).toHaveLength(0);
  });

  it("si el usuario cancela en Google, vuelve al asistente sin hacer nada", async () => {
    const calls = fakeGoogle();
    const { client } = await registerUser();
    const { cookie } = await authorize(client);
    const response = await callback(client, "error=access_denied", cookie);
    expect(response.headers.get("location")).toBe("/importar?google=denied");
    expect(calls.token).toHaveLength(0);
  });

  it("sin permiso de lectura del calendario, no se importa nada", async () => {
    fakeGoogle({ scope: "openid" });
    const { client } = await registerUser();
    const { url, cookie } = await authorize(client);
    const response = await callback(
      client,
      `code=c&state=${url.searchParams.get("state") ?? ""}`,
      cookie,
    );
    expect(response.headers.get("location")).toBe("/importar?google=error");
    expect(
      (await (await client.get("/api/imports")).json<{ imports: ImportInfo[] }>()).imports,
    ).toHaveLength(0);
  });
});

describe("importación por la API (F5-05)", () => {
  it("canjea el código con PKCE, descarga la cuenta y no guarda ningún token", async () => {
    const calls = fakeGoogle();
    const { client } = await registerUser();
    const { url, cookie } = await authorize(client);
    const state = url.searchParams.get("state") ?? "";

    const response = await runPhase(() => callback(client, `code=codigo-1&state=${state}`, cookie));
    expect(response.status).toBe(302);
    const id = /import=([^&]+)/.exec(response.headers.get("location") ?? "")?.[1] ?? "";
    // La cookie se borra al volver.
    expect(response.headers.get("set-cookie")).toMatch(/__Secure-delyra-google=;/);

    const [exchange] = calls.token;
    expect(exchange?.get("grant_type")).toBe("authorization_code");
    expect(exchange?.get("code")).toBe("codigo-1");
    expect(await sha256Base64Url(exchange?.get("code_verifier") ?? "")).toBe(
      url.searchParams.get("code_challenge"),
    );
    expect(calls.api).toContain(
      `/calendar/v3/calendars/${encodeURIComponent(PRIMARY.id)}/events?p2`,
    );

    const preview = (await (await client.get(`/api/imports/${id}`)).json<{ import: ImportInfo }>())
      .import;
    expect(preview.status).toBe("ready");
    expect(preview.calendars).toEqual([
      expect.objectContaining({
        name: "Mi calendario",
        color: "#9fe1e7",
        events: 3,
        recurring: 1,
        birthdays: 1,
        suggestSkip: false,
      }),
      expect.objectContaining({ name: "Festivos en España", suggestSkip: true }),
    ]);

    // Ni el token de acceso ni el refresh token quedan en la base de datos.
    const [row] = await createDb(env.DB).select().from(imports).where(eq(imports.id, id));
    expect(row?.googleTokenEnc).toBeNull();
    expect(JSON.stringify(row)).not.toContain(REFRESH_TOKEN);
    expect(JSON.stringify(row)).not.toContain(ACCESS_TOKEN);

    await runPhase(() =>
      client.post(`/api/imports/${id}/start`, {
        calendars: [
          { key: "0", target: "new", name: "Google", color: "#9fe1e7" },
          { key: "1", target: "skip" },
        ],
        reminders: true,
      }),
    );
    const done = (await (await client.get(`/api/imports/${id}`)).json<{ import: ImportInfo }>())
      .import;
    expect(done.status).toBe("succeeded");

    const google = (
      await (await client.get("/api/calendars")).json<{ calendars: CalendarInfo[] }>()
    ).calendars.find((c) => c.name === "Google");
    const events = (
      await (
        await client.get(
          `/api/events?from=2026-12-01T00:00:00Z&to=2027-01-01T00:00:00Z&calendars=${google?.id ?? ""}`,
        )
      ).json<{ events: Occurrence[] }>()
    ).events.map((e) => `${e.start} ${e.title}`);
    expect(events).toEqual([
      "2026-12-01T17:00:00.000Z Clase de inglés",
      "2026-12-10 Cumpleaños de Ana",
      "2026-12-15T17:30:00.000Z Clase de inglés (aula 2)",
    ]);
  });

  it("si Google rechaza el código, vuelve con error y sin importación", async () => {
    fakeGoogle({ tokenStatus: 400 });
    const { client } = await registerUser();
    const { url, cookie } = await authorize(client);
    const response = await callback(
      client,
      `code=c&state=${url.searchParams.get("state") ?? ""}`,
      cookie,
    );
    expect(response.headers.get("location")).toBe("/importar?google=error");
  });

  it("la cookie es de un solo uso (no se puede repetir el callback)", async () => {
    fakeGoogle();
    const { client } = await registerUser();
    const { url, cookie } = await authorize(client);
    const query = `code=c&state=${url.searchParams.get("state") ?? ""}`;
    await runPhase(() => callback(client, query, cookie));
    // El navegador ya no tiene la cookie (se borró en la primera vuelta): sin ella se rechaza.
    expect((await callback(client, query, null)).headers.get("location")).toBe(
      "/importar?google=state",
    );
  });
});
