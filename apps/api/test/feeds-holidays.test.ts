import type { CalendarInfo, Holiday } from "@delyra/shared";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDb } from "../src/db/client";
import { calendarFeeds } from "../src/db/schema";
import { parseIcs } from "../src/lib/ics";
import { easterSunday, nationalFallback } from "../src/services/holidays";
import { registerUser, TestClient } from "./helpers";

/** Feed ICS privado (F7-02) y festivos (F7-03). */

afterEach(() => {
  vi.restoreAllMocks();
});

async function personalCalendar(client: TestClient) {
  const { calendars } = await (
    await client.get("/api/calendars")
  ).json<{
    calendars: CalendarInfo[];
  }>();
  const personal = calendars.find((c) => c.kind === "personal");
  if (!personal) throw new Error("sin calendario personal");
  return personal;
}

const tokenOf = (url: string) => /\/api\/feeds\/([\w-]+)\.ics$/.exec(url)?.[1] ?? "";

describe("feed ICS privado (F7-02)", () => {
  it("se crea, se lee sin sesión, se regenera y se revoca", async () => {
    const { client } = await registerUser();
    const calendar = await personalCalendar(client);
    await client.post("/api/events", {
      calendarId: calendar.id,
      title: "Revisión anual",
      allDay: false,
      start: "2027-02-01T10:00:00Z",
      end: "2027-02-01T11:00:00Z",
      tz: "Europe/Madrid",
      rrule: "FREQ=YEARLY",
    });
    expect(await (await client.get(`/api/calendars/${calendar.id}/feed`)).json()).toEqual({
      feed: null,
    });

    const created = await client.post(`/api/calendars/${calendar.id}/feed`);
    expect(created.status).toBe(201);
    const { feed } = await created.json<{ feed: { url: string } }>();
    expect(feed.url).toMatch(/^http:\/\/localhost:5173\/api\/feeds\/[\w-]{43}\.ics$/);
    const again = await (
      await client.get(`/api/calendars/${calendar.id}/feed`)
    ).json<{
      feed: { url: string };
    }>();
    expect(again.feed.url).toBe(feed.url);

    // Sin sesión, como lo pediría Google o Apple.
    const anonymous = new TestClient();
    const response = await anonymous.get(`/api/feeds/${tokenOf(feed.url)}.ics`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/calendar");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    const parsed = parseIcs(await response.text(), { defaultTimeZone: "Europe/Madrid" });
    expect(parsed.name).toBe(calendar.name);
    expect(parsed.events[0]).toMatchObject({ title: "Revisión anual", rrule: "FREQ=YEARLY" });

    // En la base de datos solo hay el hash y el token cifrado.
    const [row] = await createDb(env.DB)
      .select()
      .from(calendarFeeds)
      .where(eq(calendarFeeds.calendarId, calendar.id));
    expect(JSON.stringify(row)).not.toContain(tokenOf(feed.url));

    const rotated = await (
      await client.post(`/api/calendars/${calendar.id}/feed`)
    ).json<{
      feed: { url: string };
    }>();
    expect(rotated.feed.url).not.toBe(feed.url);
    expect((await anonymous.get(`/api/feeds/${tokenOf(feed.url)}.ics`)).status).toBe(404);
    expect((await anonymous.get(`/api/feeds/${tokenOf(rotated.feed.url)}.ics`)).status).toBe(200);

    expect((await client.delete(`/api/calendars/${calendar.id}/feed`)).status).toBe(204);
    expect((await anonymous.get(`/api/feeds/${tokenOf(rotated.feed.url)}.ics`)).status).toBe(404);
  });

  it("nadie más puede crear ni ver el feed de mi calendario; un token inventado no existe", async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const calendar = await personalCalendar(alice.client);
    expect((await bob.client.post(`/api/calendars/${calendar.id}/feed`)).status).toBe(404);
    expect((await bob.client.get(`/api/calendars/${calendar.id}/feed`)).status).toBe(404);
    expect((await bob.client.delete(`/api/calendars/${calendar.id}/feed`)).status).toBe(404);
    const anonymous = new TestClient();
    for (const token of ["x", "a".repeat(43), "../../etc/passwd", `${"a".repeat(42)}%00`]) {
      expect((await anonymous.get(`/api/feeds/${token}.ics`)).status).toBe(404);
    }
  });

  it("al borrar el calendario, su feed deja de existir", async () => {
    const { client } = await registerUser();
    const created = await client.post("/api/calendars", { name: "Temporal", color: "#27ae60" });
    const { calendar } = await created.json<{ calendar: CalendarInfo }>();
    const { feed } = await (
      await client.post(`/api/calendars/${calendar.id}/feed`)
    ).json<{
      feed: { url: string };
    }>();
    await client.delete(`/api/calendars/${calendar.id}`);
    expect((await new TestClient().get(`/api/feeds/${tokenOf(feed.url)}.ics`)).status).toBe(404);
  });
});

const NAGER_2027 = [
  { date: "2027-01-01", localName: "Año Nuevo", global: true, counties: null, types: ["Public"] },
  {
    date: "2027-05-02",
    localName: "Fiesta de la Comunidad de Madrid",
    global: false,
    counties: ["ES-MD"],
    types: ["Public"],
  },
  {
    date: "2027-03-19",
    localName: "San José",
    global: false,
    counties: ["ES-VC", "ES-MC"],
    types: ["Public"],
  },
  { date: "2027-12-24", localName: "Nochebuena", global: true, counties: null, types: ["Bank"] },
  {
    date: "2027-06-01",
    localName: "<script>",
    global: true,
    counties: ["../x"],
    types: ["Public"],
  },
];

function fakeNager(status = 200) {
  const calls: string[] = [];
  const original = globalThis.fetch.bind(globalThis);
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith("https://date.nager.at/")) return original(input, init);
    calls.push(url);
    if (status !== 200) return Promise.resolve(new Response("caído", { status }));
    const year = url.split("/PublicHolidays/")[1]?.slice(0, 4);
    return Promise.resolve(Response.json(year === "2027" ? NAGER_2027 : []));
  });
  return calls;
}

async function holidays(client: TestClient, from: string, to: string) {
  const response = await client.get(`/api/holidays?from=${from}&to=${to}`);
  return response.json<{ region: string; holidays: Holiday[] }>();
}

describe("festivos (F7-03)", () => {
  it("nacionales y de la comunidad elegida (Madrid por defecto), descargados una vez", async () => {
    const calls = fakeNager();
    const { client } = await registerUser();
    const madrid = await holidays(client, "2027-01-01", "2027-12-31");
    expect(madrid.region).toBe("ES-MD");
    expect(madrid.holidays.map((h) => h.name)).toEqual([
      "Año Nuevo",
      "Fiesta de la Comunidad de Madrid",
      "<script>",
    ]);
    expect(madrid.holidays[1]?.regional).toBe(true);
    const fetched = calls.length;
    await holidays(client, "2027-03-01", "2027-03-31");
    expect(calls.length).toBe(fetched);

    expect((await client.request("PUT", "/api/holidays/region", { region: "ES-VC" })).status).toBe(
      200,
    );
    const valencia = await holidays(client, "2027-01-01", "2027-12-31");
    expect(valencia.holidays.map((h) => h.name)).toContain("San José");
    expect(valencia.holidays.map((h) => h.name)).not.toContain("Fiesta de la Comunidad de Madrid");

    await client.request("PUT", "/api/holidays/region", { region: "ES" });
    expect(
      (await holidays(client, "2027-01-01", "2027-12-31")).holidays.every((h) => !h.regional),
    ).toBe(true);
    await client.request("PUT", "/api/holidays/region", { region: "off" });
    expect((await holidays(client, "2027-01-01", "2027-12-31")).holidays).toEqual([]);
    expect((await client.request("PUT", "/api/holidays/region", { region: "XX" })).status).toBe(
      422,
    );
  });

  it("sin servicio, los nacionales calculados (con Viernes Santo)", async () => {
    fakeNager(503);
    const { client } = await registerUser();
    const result = await holidays(client, "2031-01-01", "2031-12-31");
    expect(result.holidays.map((h) => h.date)).toContain("2031-04-11");
    expect(result.holidays).toHaveLength(10);
  });

  it("Pascua y el respaldo nacional", () => {
    expect(easterSunday(2026).toISOString().slice(0, 10)).toBe("2026-04-05");
    expect(easterSunday(2027).toISOString().slice(0, 10)).toBe("2027-03-28");
    expect(nationalFallback(2028).find((h) => h.name === "Viernes Santo")?.date).toBe("2028-04-14");
  });

  it("valida el rango", async () => {
    const { client } = await registerUser();
    expect((await client.get("/api/holidays?from=2027-01-01&to=2029-01-01")).status).toBe(422);
    expect((await client.get("/api/holidays?from=hoy&to=mañana")).status).toBe(422);
  });
});
