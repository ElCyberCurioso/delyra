import type { CalendarInfo, EventDetail, ImportInfo, Occurrence } from "@delyra/shared";
import { introspectWorkflow } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { createDb } from "../src/db/client";
import { importRepository } from "../src/repositories/imports";
import { GOOGLE_EXPORT, HOSTILE, WORK_EXPORT } from "./fixtures/ics";
import { ORIGIN, registerUser, type TestClient } from "./helpers";

/** Importación de `.ics` y `.zip` con el Workflow (F5-02, F5-03, F5-07). */

// Cada prueba ejecuta el Workflow de verdad (miniflare), que tarda algo más que una petición.
vi.setConfig({ testTimeout: 30_000 });

const bytes = (text: string) => new TextEncoder().encode(text);

interface UploadOptions {
  filename?: string | null;
  type?: string;
  length?: string;
  origin?: string | null;
}

function upload(
  client: TestClient,
  body: Uint8Array,
  {
    filename = "calendario.ics",
    type = "text/calendar",
    length,
    origin = ORIGIN,
  }: UploadOptions = {},
) {
  const headers: Record<string, string> = {
    "cf-connecting-ip": client.ip,
    "Content-Type": type,
    "Content-Length": length ?? String(body.byteLength),
  };
  if (origin !== null) headers.Origin = origin;
  if (filename !== null) headers["X-Filename"] = encodeURIComponent(filename);
  if (client.cookie) headers.Cookie = `__Secure-sid=${client.cookie}`;
  return exports.default.fetch(
    new Request("https://delyra.test/api/imports", { method: "POST", headers, body }),
  );
}

async function getImport(client: TestClient, id: string) {
  return (await (await client.get(`/api/imports/${id}`)).json<{ import: ImportInfo }>()).import;
}

async function calendars(client: TestClient) {
  return (await (await client.get("/api/calendars")).json<{ calendars: CalendarInfo[] }>())
    .calendars;
}

/** Ejecuta una fase del Workflow (la que lanza `trigger`) hasta que termina. */
async function runPhase(trigger: () => Promise<Response>) {
  const introspector = await introspectWorkflow(env.IMPORT_WORKFLOW);
  try {
    const response = await trigger();
    const instances = await introspector.get();
    for (const instance of instances) await instance.waitForStatus("complete");
    return response;
  } finally {
    await introspector.dispose();
  }
}

async function analyze(client: TestClient, body: Uint8Array, options?: UploadOptions) {
  const response = await runPhase(() => upload(client, body, options));
  expect(response.status).toBe(202);
  const { import: created } = await response.json<{ import: ImportInfo }>();
  return getImport(client, created.id);
}

async function start(client: TestClient, id: string, body: unknown) {
  const response = await runPhase(() => client.post(`/api/imports/${id}/start`, body));
  return { response, result: await getImport(client, id) };
}

async function occurrences(client: TestClient, from: string, to: string) {
  const response = await client.get(
    `/api/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  );
  return (await response.json<{ events: Occurrence[] }>()).events;
}

describe("importar un .ics (F5-02)", () => {
  it("analiza, importa y conserva recurrencias, excepciones y alertas", async () => {
    const { client } = await registerUser();
    const personal = (await calendars(client)).find((c) => c.kind === "personal");

    const preview = await analyze(client, bytes(GOOGLE_EXPORT));
    expect(preview.status).toBe("ready");
    expect(preview.calendars).toEqual([
      expect.objectContaining({
        key: "0",
        name: "Personal",
        events: 5,
        recurring: 2,
        withReminders: 2,
        // Mismo nombre que un calendario propio: se propone como destino.
        suggestedCalendarId: personal?.id,
      }),
    ]);

    const { response, result } = await start(client, preview.id, {
      calendars: [{ key: "0", target: "existing", calendarId: personal?.id }],
      reminders: true,
    });
    expect(response.status).toBe(202);
    expect(result.status).toBe("succeeded");
    expect(result.report).toMatchObject({ created: 5, updated: 0, unchanged: 0 });

    const weekly = (await occurrences(client, "2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z"))
      .filter((o) => o.title.startsWith("Reunión semanal"))
      .map((o) => `${o.start} ${o.title}`);
    // Lunes 2, 16 (movida a las 12:00) y 30; el 9 estaba borrado y el 23 cancelado.
    expect(weekly).toEqual([
      "2026-11-02T09:00:00.000Z Reunión semanal",
      "2026-11-16T11:00:00.000Z Reunión semanal (movida)",
      "2026-11-30T09:00:00.000Z Reunión semanal",
    ]);
    const series = (await occurrences(client, "2026-11-02T00:00:00Z", "2026-11-03T00:00:00Z"))[0];
    const detail = await (
      await client.get(`/api/events/${series?.eventId ?? ""}`)
    ).json<{
      event: EventDetail;
    }>();
    expect(detail.event.reminders.map((r) => r.offsetMinutes)).toEqual([10]);
    expect(detail.event.location).toBe("Oficina, planta 2");

    // Los datos temporales se borran al terminar.
    const me = await (await client.get("/api/auth/me")).json<{ user: { id: string } }>();
    const left = await env.IMPORTS.list({ prefix: `imports/${me.user.id}/${preview.id}/` });
    expect(left.objects).toHaveLength(0);
  });

  it("repetir la misma importación no crea duplicados", async () => {
    const { client } = await registerUser();
    const personal = (await calendars(client)).find((c) => c.kind === "personal");
    const choice = { calendars: [{ key: "0", target: "existing", calendarId: personal?.id }] };
    const first = await analyze(client, bytes(GOOGLE_EXPORT));
    await start(client, first.id, choice);
    const before = await occurrences(client, "2026-01-01T00:00:00Z", "2027-01-01T00:00:00Z");

    const second = await analyze(client, bytes(GOOGLE_EXPORT));
    // Aunque esta vez se elija un calendario nuevo, lo ya importado se reconoce por su UID.
    const { result } = await start(client, second.id, {
      calendars: [{ key: "0", target: "new", name: "Otra vez", color: "#27ae60" }],
    });
    expect(result.report).toMatchObject({ created: 0, updated: 0, unchanged: 5 });
    const after = await occurrences(client, "2026-01-01T00:00:00Z", "2027-01-01T00:00:00Z");
    expect(after).toHaveLength(before.length);
    // Y el calendario nuevo no se llega a crear porque no hacía falta.
    expect((await calendars(client)).some((c) => c.name === "Otra vez")).toBe(false);
  });

  it("un cambio en el origen actualiza el evento en su sitio", async () => {
    const { client } = await registerUser();
    const work = (await calendars(client)).find((c) => c.kind === "work");
    const choice = { calendars: [{ key: "0", target: "existing", calendarId: work?.id }] };
    await start(client, (await analyze(client, bytes(WORK_EXPORT))).id, choice);
    const changed = WORK_EXPORT.replace("SUMMARY:Daily", "SUMMARY:Daily del equipo");
    const { result } = await start(client, (await analyze(client, bytes(changed))).id, choice);
    expect(result.report).toMatchObject({ created: 0, updated: 1 });
    const titles = (await occurrences(client, "2026-12-01T00:00:00Z", "2026-12-08T00:00:00Z")).map(
      (o) => o.title,
    );
    expect(titles).toEqual(Array(5).fill("Daily del equipo"));
  });
});

describe("importar el .zip de Google (F5-02, F5-03)", () => {
  it("un calendario por fichero, con destino nuevo o descartado", async () => {
    const { client } = await registerUser();
    const zip = zipSync({
      "Personal_abc@group.calendar.google.com.ics": strToU8(GOOGLE_EXPORT),
      "Trabajo_def@group.calendar.google.com.ics": strToU8(WORK_EXPORT),
    });
    const preview = await analyze(client, zip, {
      filename: "takeout.zip",
      type: "application/zip",
    });
    expect(preview.calendars.map((c) => [c.name, c.events])).toEqual([
      ["Personal", 5],
      ["Trabajo", 1],
    ]);
    const { result } = await start(client, preview.id, {
      calendars: [
        { key: "0", target: "skip" },
        { key: "1", target: "new", name: "Trabajo (Google)", color: "#f2994a" },
      ],
      reminders: false,
    });
    expect(result.status).toBe("succeeded");
    expect(result.report?.calendars).toEqual([
      expect.objectContaining({ name: "Trabajo (Google)", created: 1 }),
    ]);
    const created = (await calendars(client)).find((c) => c.name === "Trabajo (Google)");
    expect(created).toMatchObject({ color: "#f2994a", readOnly: false });
    const events = await occurrences(client, "2026-11-01T00:00:00Z", "2027-01-01T00:00:00Z");
    expect(events.every((e) => e.calendarId === created?.id)).toBe(true);
  });

  it("un zip dañado deja la importación fallida con un mensaje claro", async () => {
    const { client } = await registerUser();
    const broken = zipSync({ "a.ics": strToU8(WORK_EXPORT) }).slice(0, 80);
    const result = await analyze(client, broken, { filename: "roto.zip", type: "application/zip" });
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/zip/i);
  });

  it("los textos hostiles se guardan como texto plano", async () => {
    const { client } = await registerUser();
    const preview = await analyze(client, bytes(HOSTILE), { filename: "<script>.ics" });
    expect(preview.filename).toBe("_script_.ics");
    expect(preview.calendars[0]?.name).toBe("script");
    const personal = (await calendars(client)).find((c) => c.kind === "personal");
    await start(client, preview.id, {
      calendars: [{ key: "0", target: "existing", calendarId: personal?.id }],
    });
    const [event] = await occurrences(client, "2026-12-01T00:00:00Z", "2026-12-02T00:00:00Z");
    expect(event).toMatchObject({ title: "alert('xss')Hola", url: null, location: "Plaza" });
  });
});

describe("validación y permisos (F5-07)", () => {
  it("rechaza ficheros que no son calendarios, demasiado grandes o sin cabeceras", async () => {
    const { client } = await registerUser();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect((await upload(client, png, { filename: "foto.ics" })).status).toBe(415);
    expect((await upload(client, bytes("<html>hola</html>"))).status).toBe(415);
    expect(
      (await upload(client, bytes(WORK_EXPORT), { length: String(26 * 1024 * 1024) })).status,
    ).toBe(413);
    // Sin `X-Filename` (un formulario HTML no puede añadirla) ni `Origin`: CSRF.
    expect((await upload(client, bytes(WORK_EXPORT), { filename: null })).status).toBe(415);
    expect((await upload(client, bytes(WORK_EXPORT), { origin: null })).status).toBe(403);
    expect(
      (await upload(new (client.constructor as typeof TestClient)(), bytes(WORK_EXPORT))).status,
    ).toBe(401);
  });

  it("la importación de otro usuario no existe (404) y no se pueden usar sus calendarios", async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const preview = await analyze(alice.client, bytes(WORK_EXPORT));
    expect((await bob.client.get(`/api/imports/${preview.id}`)).status).toBe(404);
    expect(
      (
        await bob.client.post(`/api/imports/${preview.id}/start`, {
          calendars: [{ key: "0", target: "new", name: "X", color: "#27ae60" }],
        })
      ).status,
    ).toBe(404);
    expect((await bob.client.delete(`/api/imports/${preview.id}`)).status).toBe(404);

    const bobCalendar = (await calendars(bob.client))[0];
    const response = await alice.client.post(`/api/imports/${preview.id}/start`, {
      calendars: [{ key: "0", target: "existing", calendarId: bobCalendar?.id }],
    });
    expect(response.status).toBe(422);
    const unknown = await alice.client.post(`/api/imports/${preview.id}/start`, {
      calendars: [{ key: "7", target: "new", name: "X", color: "#27ae60" }],
    });
    expect(unknown.status).toBe(422);
    const nothing = await alice.client.post(`/api/imports/${preview.id}/start`, {
      calendars: [{ key: "0", target: "skip" }],
    });
    expect(nothing.status).toBe(422);
  });

  it("una importación a la vez y no se empieza dos veces", async () => {
    const { client } = await registerUser();
    const me = await (await client.get("/api/auth/me")).json<{ user: { id: string } }>();
    const repo = importRepository(createDb(env.DB), me.user.id);
    const busy = await repo.create({
      source: "file",
      status: "analyzing",
      filename: "a.ics",
      sizeBytes: 1,
    });
    expect((await upload(client, bytes(WORK_EXPORT))).status).toBe(409);
    await repo.update(busy.id, { status: "failed" });

    const preview = await analyze(client, bytes(WORK_EXPORT));
    const choice = { calendars: [{ key: "0", target: "new", name: "Uno", color: "#27ae60" }] };
    const { response } = await start(client, preview.id, choice);
    expect(response.status).toBe(202);
    expect((await client.post(`/api/imports/${preview.id}/start`, choice)).status).toBe(409);
  });

  it("descartar una vista previa borra sus datos", async () => {
    const { client } = await registerUser();
    const me = await (await client.get("/api/auth/me")).json<{ user: { id: string } }>();
    const preview = await analyze(client, bytes(WORK_EXPORT));
    expect(
      (await env.IMPORTS.list({ prefix: `imports/${me.user.id}/${preview.id}/` })).objects.length,
    ).toBeGreaterThan(0);
    expect((await client.delete(`/api/imports/${preview.id}`)).status).toBe(204);
    expect(
      (await env.IMPORTS.list({ prefix: `imports/${me.user.id}/${preview.id}/` })).objects,
    ).toHaveLength(0);
    expect((await client.get(`/api/imports/${preview.id}`)).status).toBe(404);
  });
});
