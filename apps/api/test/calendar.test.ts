import type { CalendarInfo, EventDetail, Occurrence } from "@delyra/shared";
import { describe, expect, it } from "vitest";
import { registerUser, type TestClient } from "./helpers";

const MADRID = "Europe/Madrid";

async function calendarsOf(client: TestClient) {
  const response = await client.get("/api/calendars");
  return (await response.json<{ calendars: CalendarInfo[] }>()).calendars;
}

async function personal(client: TestClient) {
  const calendars = await calendarsOf(client);
  return calendars.find((c) => c.kind === "personal")?.id ?? "";
}

async function create(client: TestClient, body: Record<string, unknown>) {
  const response = await client.post("/api/events", { tz: MADRID, allDay: false, ...body });
  if (response.status !== 201) {
    throw new Error(`crear evento: ${String(response.status)} ${await response.text()}`);
  }
  return (await response.json<{ event: EventDetail }>()).event;
}

async function list(client: TestClient, from: string, to: string, extra = "") {
  const response = await client.get(
    `/api/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${extra}`,
  );
  if (response.status !== 200) throw new Error(`listar: ${String(response.status)}`);
  return (await response.json<{ events: Occurrence[] }>()).events;
}

const starts = (events: Occurrence[]) => events.map((e) => e.start);

describe("calendarios", () => {
  it("cada usuario empieza con Personal, Trabajo y Cumpleaños", async () => {
    const { client } = await registerUser();
    const calendars = await calendarsOf(client);
    expect(calendars.map((c) => [c.name, c.kind])).toEqual([
      ["Personal", "personal"],
      ["Trabajo", "work"],
      ["Cumpleaños", "birthdays"],
    ]);
  });

  it("se crean, se renombran, se ocultan y se borran con sus eventos", async () => {
    const { client } = await registerUser();
    const created = await client.post("/api/calendars", { name: "Deporte", color: "#27ae60" });
    expect(created.status).toBe(201);
    const { calendar } = await created.json<{ calendar: CalendarInfo }>();
    const patched = await client.request("PATCH", `/api/calendars/${calendar.id}`, {
      name: "Gimnasio",
      visible: false,
    });
    expect(await patched.json()).toMatchObject({ calendar: { name: "Gimnasio", visible: false } });

    await create(client, {
      calendarId: calendar.id,
      title: "Pesas",
      start: "2027-01-11T17:00:00Z",
      end: "2027-01-11T18:00:00Z",
      reminders: [{ offsetMinutes: 10 }],
    });
    expect((await client.delete(`/api/calendars/${calendar.id}`)).status).toBe(204);
    expect(await list(client, "2027-01-01T00:00:00Z", "2027-02-01T00:00:00Z")).toHaveLength(0);
  });

  it("no deja borrar el último calendario", async () => {
    const { client } = await registerUser();
    const calendars = await calendarsOf(client);
    for (const calendar of calendars.slice(1)) await client.delete(`/api/calendars/${calendar.id}`);
    const last = await client.delete(`/api/calendars/${calendars[0]?.id ?? ""}`);
    expect(last.status).toBe(409);
  });
});

describe("eventos", () => {
  it("crea, lee, edita y borra un evento con hora", async () => {
    const { client } = await registerUser();
    const calendarId = await personal(client);
    const event = await create(client, {
      calendarId,
      title: "Dentista",
      location: "Calle Mayor 1",
      start: "2027-01-12T16:30:00Z",
      end: "2027-01-12T17:30:00Z",
    });
    expect(event).toMatchObject({ title: "Dentista", rrule: null, allDay: false });

    const occurrences = await list(client, "2027-01-12T00:00:00Z", "2027-01-13T00:00:00Z");
    expect(occurrences).toEqual([
      expect.objectContaining({
        id: event.id,
        eventId: event.id,
        start: "2027-01-12T16:30:00.000Z",
        recurring: false,
      }),
    ]);

    const edited = await client.request("PATCH", `/api/events/${event.id}`, {
      title: "Dentista (revisión)",
      allDay: false,
      start: "2027-01-12T17:00:00Z",
      end: "2027-01-12T18:00:00Z",
    });
    expect(await edited.json()).toMatchObject({
      event: { title: "Dentista (revisión)", start: "2027-01-12T17:00:00.000Z" },
    });
    expect((await client.delete(`/api/events/${event.id}`)).status).toBe(204);
    expect((await client.get(`/api/events/${event.id}`)).status).toBe(404);
  });

  it("los de día completo usan fechas y el fin es exclusivo", async () => {
    const { client } = await registerUser();
    const event = await create(client, {
      calendarId: await personal(client),
      title: "Vacaciones",
      allDay: true,
      start: "2027-08-02",
      end: "2027-08-16",
    });
    expect(event).toMatchObject({ start: "2027-08-02", end: "2027-08-16" });
    const [occurrence] = await list(client, "2027-08-15T00:00:00Z", "2027-08-15T12:00:00Z");
    expect(occurrence?.title).toBe("Vacaciones");
  });

  it.each([
    [{ start: "2027-01-12T17:00:00Z", end: "2027-01-12T16:00:00Z" }, "end"],
    [{ rrule: "FREQ=MINUTELY" }, "rrule"],
    [{ rrule: "FREQ=DAILY;BYHOUR=3" }, "rrule"],
    [{ url: "javascript:alert(1)" }, "url"],
    [{ title: "x".repeat(201) }, "title"],
    [{ allDay: true, start: "2027-02-30", end: "2027-03-01" }, "start"],
  ])("rechaza datos no válidos (%o)", async (override, path) => {
    const { client } = await registerUser();
    const response = await client.post("/api/events", {
      calendarId: await personal(client),
      title: "Evento",
      tz: MADRID,
      allDay: false,
      start: "2027-01-12T16:00:00Z",
      end: "2027-01-12T17:00:00Z",
      ...override,
    });
    expect(response.status).toBe(422);
    const problem = await response.json<{ errors: { path: string }[] }>();
    expect(problem.errors.map((e) => e.path)).toContain(path);
  });

  it("limita el rango de consulta a 400 días", async () => {
    const { client } = await registerUser();
    const response = await client.get(
      "/api/events?from=2027-01-01T00:00:00Z&to=2028-06-01T00:00:00Z",
    );
    expect(response.status).toBe(422);
  });
});

describe("series y cambio de horario", () => {
  it("una cita semanal a las 10:00 de Madrid sigue a las 10:00 en marzo", async () => {
    const { client } = await registerUser();
    await create(client, {
      calendarId: await personal(client),
      title: "Reunión",
      start: "2027-03-22T09:00:00Z", // lunes 10:00 CET
      end: "2027-03-22T10:00:00Z",
      rrule: "FREQ=WEEKLY;BYDAY=MO",
    });
    const occurrences = await list(client, "2027-03-20T00:00:00Z", "2027-04-06T00:00:00Z");
    expect(starts(occurrences)).toEqual([
      "2027-03-22T09:00:00.000Z",
      "2027-03-29T08:00:00.000Z",
      "2027-04-05T08:00:00.000Z",
    ]);
    expect(occurrences.every((o) => o.recurring)).toBe(true);
  });
});

describe("excepciones de recurrencia (F2-05)", () => {
  async function weeklySeries(client: TestClient, extra: Record<string, unknown> = {}) {
    return create(client, {
      calendarId: await personal(client),
      title: "Yoga",
      start: "2027-01-04T17:00:00Z", // lunes 18:00 CET
      end: "2027-01-04T18:00:00Z",
      rrule: "FREQ=WEEKLY",
      ...extra,
    });
  }
  const JAN = ["2027-01-01T00:00:00Z", "2027-02-01T00:00:00Z"] as const;

  it("«solo este» mueve una ocurrencia y «borrar solo este» la quita", async () => {
    const { client } = await registerUser();
    const series = await weeklySeries(client);
    const moved = await client.request("PATCH", `/api/events/${series.id}`, {
      scope: "this",
      occurrenceStart: "2027-01-11T17:00:00.000Z",
      title: "Yoga (en el parque)",
      allDay: false,
      start: "2027-01-12T17:00:00Z",
      end: "2027-01-12T18:00:00Z",
    });
    expect(moved.status).toBe(200);
    expect(
      (
        await client.delete(
          `/api/events/${series.id}?scope=this&occurrence=${encodeURIComponent("2027-01-18T17:00:00.000Z")}`,
        )
      ).status,
    ).toBe(204);

    const occurrences = await list(client, ...JAN);
    expect(occurrences.map((o) => [o.start, o.title])).toEqual([
      ["2027-01-04T17:00:00.000Z", "Yoga"],
      ["2027-01-12T17:00:00.000Z", "Yoga (en el parque)"],
      ["2027-01-25T17:00:00.000Z", "Yoga"],
    ]);
    const exception = occurrences[1];
    expect(exception).toMatchObject({
      eventId: series.id,
      originalStart: "2027-01-11T17:00:00.000Z",
      recurring: true,
    });

    // Editar otra vez la misma ocurrencia actualiza la excepción, no crea otra.
    await client.request("PATCH", `/api/events/${series.id}`, {
      scope: "this",
      occurrenceStart: "2027-01-11T17:00:00.000Z",
      title: "Yoga (cancelado por lluvia)",
    });
    const titles = (await list(client, ...JAN)).map((o) => o.title);
    expect(titles).toEqual(["Yoga", "Yoga (cancelado por lluvia)", "Yoga"]);
  });

  it("rechaza ocurrencias que la regla no genera", async () => {
    const { client } = await registerUser();
    const series = await weeklySeries(client);
    const response = await client.request("PATCH", `/api/events/${series.id}`, {
      scope: "this",
      occurrenceStart: "2027-01-05T17:00:00.000Z",
      title: "x",
    });
    expect(response.status).toBe(422);
  });

  it("«este y los siguientes» parte la serie en dos", async () => {
    const { client } = await registerUser();
    const series = await weeklySeries(client, { reminders: [{ offsetMinutes: 30 }] });
    const response = await client.request("PATCH", `/api/events/${series.id}`, {
      scope: "following",
      occurrenceStart: "2027-01-18T17:00:00.000Z",
      title: "Yoga avanzado",
      allDay: false,
      start: "2027-01-18T18:00:00Z",
      end: "2027-01-18T19:00:00Z",
    });
    const { event: created } = await response.json<{ event: EventDetail }>();
    expect(created.id).not.toBe(series.id);
    expect(created.rrule).toBe("FREQ=WEEKLY");
    expect(created.reminders.map((r) => r.offsetMinutes)).toEqual([30]);

    const occurrences = await list(client, ...JAN);
    expect(occurrences.map((o) => [o.start, o.title])).toEqual([
      ["2027-01-04T17:00:00.000Z", "Yoga"],
      ["2027-01-11T17:00:00.000Z", "Yoga"],
      ["2027-01-18T18:00:00.000Z", "Yoga avanzado"],
      ["2027-01-25T18:00:00.000Z", "Yoga avanzado"],
    ]);
    const original = await (
      await client.get(`/api/events/${series.id}`)
    ).json<{
      event: EventDetail;
    }>();
    expect(original.event.rrule).toMatch(/UNTIL=/);
  });

  it("«todos» con otra hora mueve la serie y conserva los borrados", async () => {
    const { client } = await registerUser();
    const series = await weeklySeries(client);
    await client.delete(
      `/api/events/${series.id}?scope=this&occurrence=${encodeURIComponent("2027-01-11T17:00:00.000Z")}`,
    );
    await client.request("PATCH", `/api/events/${series.id}`, {
      scope: "all",
      allDay: false,
      start: "2027-01-04T18:30:00Z",
      end: "2027-01-04T19:30:00Z",
    });
    expect(starts(await list(client, ...JAN))).toEqual([
      "2027-01-04T18:30:00.000Z",
      "2027-01-18T18:30:00.000Z",
      "2027-01-25T18:30:00.000Z",
    ]);
  });

  it("borrar «este y los siguientes» corta la serie; «todos» la elimina", async () => {
    const { client } = await registerUser();
    const series = await weeklySeries(client);
    await client.delete(
      `/api/events/${series.id}?scope=following&occurrence=${encodeURIComponent("2027-01-18T17:00:00.000Z")}`,
    );
    expect(starts(await list(client, ...JAN))).toEqual([
      "2027-01-04T17:00:00.000Z",
      "2027-01-11T17:00:00.000Z",
    ]);
    await client.delete(`/api/events/${series.id}?scope=all`);
    expect(await list(client, ...JAN)).toHaveLength(0);
  });
});

describe("cumpleaños (F2-06)", () => {
  it("se repiten cada año, muestran la edad y traen dos alertas por defecto", async () => {
    const { client } = await registerUser();
    const birthdays = (await calendarsOf(client)).find((c) => c.kind === "birthdays")?.id ?? "";
    const event = await create(client, {
      calendarId: birthdays,
      type: "birthday",
      title: "Cumpleaños de Lucía",
      allDay: true,
      start: "1990-05-17",
      end: "1990-05-18",
      birthYear: 1990,
    });
    expect(event.reminders.map((r) => r.offsetMinutes)).toEqual([-540, 900]);
    expect(event.reminders.every((r) => r.nextFireAt !== null)).toBe(true);

    const [occurrence] = await list(client, "2027-05-01T00:00:00Z", "2027-06-01T00:00:00Z");
    expect(occurrence).toMatchObject({ start: "2027-05-17", age: 37, type: "birthday" });
  });

  it("el 29 de febrero se celebra el 1 de marzo si se elige así", async () => {
    const { client } = await registerUser();
    await create(client, {
      calendarId: await personal(client),
      type: "birthday",
      title: "Cumpleaños de Pablo",
      allDay: true,
      start: "2000-02-29",
      end: "2000-03-01",
      feb29Rule: "mar1",
      reminders: [],
    });
    const [occurrence] = await list(client, "2027-02-01T00:00:00Z", "2027-03-31T00:00:00Z");
    expect(occurrence?.start).toBe("2027-03-01");
  });
});

describe("alertas (F2-07)", () => {
  it("calcula next_fire_at y lo recalcula al mover el evento", async () => {
    const { client } = await registerUser();
    const event = await create(client, {
      calendarId: await personal(client),
      title: "Vuelo",
      start: "2027-07-01T06:00:00Z",
      end: "2027-07-01T08:00:00Z",
      reminders: [{ offsetMinutes: 120 }, { offsetMinutes: 120 }],
    });
    expect(event.reminders).toEqual([
      expect.objectContaining({ offsetMinutes: 120, nextFireAt: "2027-07-01T04:00:00.000Z" }),
    ]);
    const moved = await client.request("PATCH", `/api/events/${event.id}`, {
      allDay: false,
      start: "2027-07-02T06:00:00Z",
      end: "2027-07-02T08:00:00Z",
    });
    const { event: updated } = await moved.json<{ event: EventDetail }>();
    expect(updated.reminders[0]?.nextFireAt).toBe("2027-07-02T04:00:00.000Z");
  });

  it("al cambiar de zona horaria se recalculan las de día completo", async () => {
    const { client } = await registerUser();
    const event = await create(client, {
      calendarId: await personal(client),
      title: "Aniversario",
      allDay: true,
      start: "2027-09-10",
      end: "2027-09-11",
      reminders: [{ offsetMinutes: -540 }],
    });
    expect(event.reminders[0]?.nextFireAt).toBe("2027-09-10T07:00:00.000Z"); // 9:00 CEST
    await client.request("PATCH", "/api/me/settings", {
      timeZone: "America/Bogota",
      locale: "es",
      weekStart: 1,
    });
    const after = await (
      await client.get(`/api/events/${event.id}`)
    ).json<{ event: EventDetail }>();
    expect(after.event.reminders[0]?.nextFireAt).toBe("2027-09-10T14:00:00.000Z"); // 9:00 UTC−5
  });
});

describe("búsqueda (F2-13)", () => {
  it("busca en título, notas y ubicación, y trata % y _ como texto", async () => {
    const { client } = await registerUser();
    const calendarId = await personal(client);
    const base = { calendarId, start: "2027-01-12T16:00:00Z", end: "2027-01-12T17:00:00Z" };
    await create(client, { ...base, title: "Cena con Marta" });
    await create(client, { ...base, title: "Revisión", notes: "llevar el informe de Marta" });
    await create(client, { ...base, title: "Pádel", location: "Club 100% deporte" });

    const search = async (q: string) =>
      (
        await (
          await client.get(`/api/events/search?q=${encodeURIComponent(q)}`)
        ).json<{
          events: Occurrence[];
        }>()
      ).events.map((e) => e.title);
    expect(await search("marta")).toEqual(["Cena con Marta", "Revisión"]);
    expect(await search("100%")).toEqual(["Pádel"]);
    expect(await search("%%")).toEqual([]);
  });
});

describe("permisos (F2-02)", () => {
  /** Cada endpoint con id de otro usuario responde 404, igual que si no existiera. */
  async function expectForeign404(client: TestClient, requests: [string, string, unknown?][]) {
    for (const [method, path, body] of requests) {
      const response = await client.request(method, path, body ?? {});
      expect(`${method} ${path} → ${String(response.status)}`).toBe(`${method} ${path} → 404`);
    }
  }

  it("un usuario no ve ni toca eventos ni calendarios de otro", async () => {
    const ana = await registerUser();
    const luis = await registerUser();
    const anaCalendar = await personal(ana.client);
    const event = await create(ana.client, {
      calendarId: anaCalendar,
      title: "Privado",
      start: "2027-01-12T16:00:00Z",
      end: "2027-01-12T17:00:00Z",
      rrule: "FREQ=DAILY;COUNT=3",
    });

    await expectForeign404(luis.client, [
      ["GET", `/api/events/${event.id}`],
      ["PATCH", `/api/events/${event.id}`, { title: "Mío" }],
      ["DELETE", `/api/events/${event.id}?scope=all`],
      ["PATCH", `/api/calendars/${anaCalendar}`, { name: "Mío" }],
      ["DELETE", `/api/calendars/${anaCalendar}`],
    ]);

    expect(await list(luis.client, "2027-01-01T00:00:00Z", "2027-02-01T00:00:00Z")).toHaveLength(0);
    const search = await luis.client.get("/api/events/search?q=Privado");
    expect(await search.json()).toEqual({ events: [] });

    // Crear en un calendario ajeno falla igual que en uno inexistente.
    const foreign = await luis.client.post("/api/events", {
      calendarId: anaCalendar,
      title: "Intruso",
      tz: MADRID,
      allDay: false,
      start: "2027-01-12T16:00:00Z",
      end: "2027-01-12T17:00:00Z",
    });
    expect(foreign.status).toBe(422);
    expect((await list(ana.client, "2027-01-12T00:00:00Z", "2027-01-15T00:00:00Z")).length).toBe(3);
  });
});
