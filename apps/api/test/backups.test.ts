import type {
  BackupDataV1,
  BoardDetail,
  CalendarInfo,
  CardDetail,
  EventDetail,
  RestoreInfo,
  UserBackupInfo,
} from "@delyra/shared";
import { introspectWorkflow } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { strFromU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { scheduleAutoBackups } from "../src/jobs/auto-backups";
import { createDb } from "../src/db/client";
import { buildBackupJson } from "../src/lib/backup-format";
import { sha256Hex } from "../src/lib/crypto";
import { parseIcs } from "../src/lib/ics";
import { createLogger } from "../src/lib/logger";
import { csvCell } from "../src/services/exports";
import { tierKeys } from "../src/services/system-backups";
import { backupRepository, collectBackupData, pruneBackups } from "../src/services/user-backups";
import { ORIGIN, registerUser, type TestClient } from "./helpers";

/** Copias de usuario y restauración (F6-01 a F6-05, F6-09). */

vi.setConfig({ testTimeout: 60_000 });

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

async function runPhase(trigger: () => Promise<Response>) {
  const introspector = await introspectWorkflow(env.BACKUP_WORKFLOW);
  try {
    const response = await trigger();
    for (const instance of await introspector.get()) await instance.waitForStatus("complete");
    return response;
  } finally {
    await introspector.dispose();
  }
}

async function json<T>(response: Response | Promise<Response>): Promise<T> {
  return (await response).json<T>();
}

async function me(client: TestClient) {
  return (await json<{ user: { id: string } }>(client.get("/api/auth/me"))).user.id;
}

function upload(client: TestClient, path: string, body: Uint8Array, filename: string) {
  return exports.default.fetch(
    new Request(`https://delyra.test${path}`, {
      method: "POST",
      headers: {
        "cf-connecting-ip": client.ip,
        Origin: ORIGIN,
        "Content-Type": "application/octet-stream",
        "Content-Length": String(body.byteLength),
        "X-Filename": encodeURIComponent(filename),
        ...(client.cookie ? { Cookie: `__Secure-sid=${client.cookie}` } : {}),
      },
      body,
    }),
  );
}

/** Datos de prueba: serie con excepción y borrado, cumpleaños, alertas y un tablero completo. */
async function seed(client: TestClient) {
  const calendars = (await json<{ calendars: CalendarInfo[] }>(client.get("/api/calendars")))
    .calendars;
  const personal = calendars.find((c) => c.kind === "personal");
  const series = (
    await json<{ event: EventDetail }>(
      client.post("/api/events", {
        calendarId: personal?.id,
        title: "Clase semanal",
        notes: "Con notas",
        allDay: false,
        start: "2027-03-01T09:00:00Z",
        end: "2027-03-01T10:00:00Z",
        tz: "Europe/Madrid",
        rrule: "FREQ=WEEKLY;COUNT=6",
        reminders: [{ offsetMinutes: 30, channel: "telegram" }],
      }),
    )
  ).event;
  await client.request("PATCH", `/api/events/${series.id}`, {
    scope: "this",
    occurrenceStart: "2027-03-08T09:00:00.000Z",
    title: "Clase movida",
    allDay: false,
    start: "2027-03-08T11:00:00Z",
    end: "2027-03-08T12:00:00Z",
  });
  await client.request(
    "DELETE",
    `/api/events/${series.id}?scope=this&occurrence=2027-03-15T09:00:00.000Z`,
    {},
  );
  await client.post("/api/events", {
    type: "birthday",
    calendarId: calendars.find((c) => c.kind === "birthdays")?.id,
    title: "Cumple de Ana",
    allDay: true,
    start: "1990-05-03",
    end: "1990-05-04",
    tz: "Europe/Madrid",
    birthYear: 1990,
  });

  const board = await json<BoardDetail>(
    client.post("/api/boards", { name: "Proyecto", template: "personal" }),
  );
  const { label } = await json<{ label: { id: string } }>(
    client.post(`/api/boards/${board.board.id}/labels`, { name: "Urgente", color: "#eb5757" }),
  );
  const labelId = label.id;
  const card = (
    await json<{ card: CardDetail }>(
      client.post(`/api/columns/${board.columns[0]?.id ?? ""}/cards`, { title: "Preparar demo" }),
    )
  ).card;
  await client.request("PATCH", `/api/cards/${card.id}`, {
    description: "**Importante**",
    priority: "high",
    labelIds: [labelId],
    due: { allDay: false, at: "2027-04-01T10:00:00Z", tz: "Europe/Madrid" },
    reminders: [{ offsetMinutes: 60, channel: "telegram" }],
  });
  await client.post(`/api/cards/${card.id}/checklist`, { text: "Diapositivas" });
  await client.post(`/api/cards/${card.id}/comments`, { body: "Primer comentario" });
  const attached = await upload(client, `/api/cards/${card.id}/attachments`, PNG, "foto.png");
  expect(attached.status).toBe(201);
  return { personal, series, board, card };
}

/** Lo que importa de los datos, sin ids (que cambian al restaurar). */
async function fingerprint(ownerId: string) {
  const data = await collectBackupData(createDb(env.DB), ownerId);
  const calendarName = new Map(data.calendars.map((c) => [c.id, c.name]));
  const columnName = new Map(data.columns.map((c) => [c.id, c.name]));
  const labelName = new Map(data.labels.map((l) => [l.id, l.name]));
  const eventTitle = new Map(data.events.map((e) => [e.id, e.title]));
  const sorted = (rows: string[]) => rows.sort();
  return {
    profile: data.profile,
    calendars: sorted(
      data.calendars.map((c) => `${c.name}|${c.color}|${c.kind}|${String(c.visible)}`),
    ),
    events: sorted(
      data.events.map((e) =>
        [
          calendarName.get(e.calendarId),
          e.type,
          e.title,
          e.notes,
          e.startAt,
          e.endAt,
          e.tz,
          e.allDay,
          e.rrule,
          e.exdates.join(","),
          e.recurringEventId ? eventTitle.get(e.recurringEventId) : "",
          e.originalStart,
          e.birthYear,
        ].join("|"),
      ),
    ),
    eventReminders: sorted(
      data.eventReminders.map(
        (r) => `${eventTitle.get(r.eventId) ?? ""}|${String(r.offsetMinutes)}`,
      ),
    ),
    boards: sorted(data.boards.map((b) => `${b.name}|${b.template}`)),
    cards: sorted(
      data.cards.map((c) =>
        [
          columnName.get(c.columnId),
          c.title,
          c.description,
          c.priority,
          c.dueAt,
          data.cardLabels
            .filter((l) => l.cardId === c.id)
            .map((l) => labelName.get(l.labelId))
            .join(","),
          data.checklist
            .filter((i) => i.cardId === c.id)
            .map((i) => i.text)
            .join(","),
          data.comments
            .filter((i) => i.cardId === c.id)
            .map((i) => i.body)
            .join(","),
          data.attachments
            .filter((a) => a.cardId === c.id)
            .map((a) => `${a.filename}:${String(a.size)}`)
            .join(","),
          data.cardReminders
            .filter((r) => r.cardId === c.id)
            .map((r) => r.offsetMinutes)
            .join(","),
        ].join("|"),
      ),
    ),
  };
}

async function createBackup(client: TestClient) {
  const response = await runPhase(() => client.post("/api/backups"));
  expect(response.status).toBe(202);
  const { backup } = await response.json<{ backup: UserBackupInfo }>();
  const list = await json<{ backups: UserBackupInfo[] }>(client.get("/api/backups"));
  return list.backups.find((b) => b.id === backup.id);
}

async function getRestore(client: TestClient, id: string) {
  return (await json<{ restore: RestoreInfo }>(client.get(`/api/restores/${id}`))).restore;
}

async function restoreFrom(client: TestClient, trigger: () => Promise<Response>) {
  const response = await runPhase(trigger);
  const { restore } = await response.json<{ restore: RestoreInfo }>();
  return getRestore(client, restore.id);
}

async function start(client: TestClient, id: string, mode: "merge" | "replace") {
  const response = await runPhase(() => client.post(`/api/restores/${id}/start`, { mode }));
  expect(response.status).toBe(202);
  return getRestore(client, id);
}

describe("copia de seguridad (F6-01, F6-02)", () => {
  it("genera un zip con backup.json (checksum) y los adjuntos, sin secretos", async () => {
    const { client } = await registerUser();
    await seed(client);
    const backup = await createBackup(client);
    expect(backup).toMatchObject({
      kind: "manual",
      status: "ready",
      counts: { calendars: 3, events: 2, boards: 1, cards: 1, attachments: 1 },
    });

    const download = await client.get(`/api/backups/${backup?.id ?? ""}/download`);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toMatch(
      /^attachment; filename="delyra-copia-/,
    );
    const files = unzipSync(new Uint8Array(await download.arrayBuffer()));
    const manifest = JSON.parse(strFromU8(files["backup.json"] ?? new Uint8Array())) as {
      format: string;
      format_version: number;
      checksum: { algorithm: string; value: string };
      data: BackupDataV1;
    };
    expect(manifest).toMatchObject({ format: "delyra-backup", format_version: 1 });
    expect(manifest.checksum.algorithm).toBe("sha256");
    const [attachment] = manifest.data.attachments;
    expect(files[`attachments/${attachment?.id ?? ""}`]).toEqual(PNG);
    const text = JSON.stringify(manifest);
    for (const secret of ["password", "totp", "secret", "chat", "token", "session"]) {
      expect(text.toLowerCase()).not.toContain(`"${secret}`);
    }
  });

  it("otra persona no puede descargar, borrar ni restaurar la copia", async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const backup = await createBackup(alice.client);
    const id = backup?.id ?? "";
    expect((await bob.client.get(`/api/backups/${id}/download`)).status).toBe(404);
    expect((await bob.client.delete(`/api/backups/${id}`)).status).toBe(404);
    expect((await bob.client.post("/api/restores", { backupId: id })).status).toBe(422);
  });
});

describe("restaurar (F6-04)", () => {
  it("borrar y restaurar en modo reemplazar devuelve exactamente los mismos datos; deshacer vuelve atrás", async () => {
    const { client } = await registerUser();
    const ownerId = await me(client);
    const { board } = await seed(client);
    const original = await fingerprint(ownerId);
    const backup = await createBackup(client);

    // Se pierde un tablero y se cambia un calendario.
    await client.delete(`/api/boards/${board.board.id}`);
    await client.post("/api/calendars", { name: "Nuevo", color: "#27ae60" });
    const changed = await fingerprint(ownerId);
    expect(changed).not.toEqual(original);

    const ready = await restoreFrom(client, () =>
      client.post("/api/restores", { backupId: backup?.id }),
    );
    expect(ready).toMatchObject({
      status: "ready",
      counts: { calendars: 3, events: 2, boards: 1, cards: 1, attachments: 1 },
    });
    const done = await start(client, ready.id, "replace");
    expect(done.status).toBe("succeeded");
    expect(done.preBackupId).not.toBeNull();
    expect(await fingerprint(ownerId)).toEqual(original);

    // El adjunto se puede descargar y sus alertas están programadas.
    const restoredBoard = (await json<{ boards: { id: string }[] }>(client.get("/api/boards")))
      .boards[0];
    const detail = await json<BoardDetail>(client.get(`/api/boards/${restoredBoard?.id ?? ""}`));
    const card = await json<{ card: CardDetail }>(
      client.get(`/api/cards/${detail.cards[0]?.id ?? ""}`),
    );
    const file = await client.get(`/api/attachments/${card.card.attachmentList[0]?.id ?? ""}`);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PNG);
    expect(card.card.reminders.map((r) => r.offsetMinutes)).toEqual([60]);

    // Deshacer: vuelve a como estaba justo antes de restaurar.
    const undo = await runPhase(() => client.post(`/api/restores/${done.id}/undo`));
    expect(undo.status).toBe(202);
    expect(await fingerprint(ownerId)).toEqual(changed);
    expect((await getRestore(client, done.id)).status).toBe("undone");
  });

  it("fusionar no duplica eventos idénticos y añade los tableros con otro nombre", async () => {
    const { client } = await registerUser();
    const ownerId = await me(client);
    await seed(client);
    const before = await fingerprint(ownerId);
    const backup = await createBackup(client);
    const ready = await restoreFrom(client, () =>
      client.post("/api/restores", { backupId: backup?.id }),
    );
    const done = await start(client, ready.id, "merge");
    expect(done.status).toBe("succeeded");
    const after = await fingerprint(ownerId);
    expect(after.events).toEqual(before.events);
    expect(after.calendars).toEqual(before.calendars);
    expect(after.boards).toEqual(["Proyecto (restaurado)|personal", "Proyecto|personal"]);
  });

  it("se puede restaurar un backup.json suelto subido como fichero", async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    await seed(alice.client);
    const data = await collectBackupData(createDb(env.DB), await me(alice.client));
    const text = await buildBackupJson(
      { ...data, attachments: [] },
      { exportedAt: new Date(), appVersion: null },
    );
    const ready = await restoreFrom(bob.client, () =>
      upload(bob.client, "/api/restores/upload", new TextEncoder().encode(text), "copia.json"),
    );
    expect(ready.status).toBe("ready");
    const done = await start(bob.client, ready.id, "replace");
    expect(done.status).toBe("succeeded");
    const events = (await fingerprint(await me(bob.client))).events;
    expect(events.some((e) => e.includes("Clase movida"))).toBe(true);
  });
});

describe("copias manipuladas (F6-09)", () => {
  async function tampered(
    client: TestClient,
    mutate: (file: { format_version: number; data: BackupDataV1 }) => void,
    resign = false,
  ) {
    const data = await collectBackupData(createDb(env.DB), await me(client));
    const file = JSON.parse(
      await buildBackupJson(
        { ...data, attachments: [] },
        { exportedAt: new Date(), appVersion: null },
      ),
    ) as { format_version: number; checksum: { value: string }; data: BackupDataV1 };
    mutate(file);
    // Quien manipula a conciencia también recalcula el checksum.
    if (resign) file.checksum.value = await sha256Hex(JSON.stringify(file.data));
    return new TextEncoder().encode(JSON.stringify(file));
  }

  it("rechaza un checksum que no coincide, una versión desconocida y referencias ajenas", async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    await seed(alice.client);
    const bobId = await me(bob.client);
    const bobBefore = await fingerprint(bobId);
    const bobCalendar = (
      await json<{ calendars: CalendarInfo[] }>(bob.client.get("/api/calendars"))
    ).calendars[0];
    const firstEvent = (file: { data: BackupDataV1 }) => {
      const [event] = file.data.events;
      if (!event) throw new Error("sin eventos");
      return event;
    };

    const cases: [string, Uint8Array][] = [
      [
        "checksum",
        await tampered(alice.client, (file) => {
          firstEvent(file).title = "Cambiado a mano";
        }),
      ],
      [
        "versión",
        await tampered(
          alice.client,
          (file) => {
            file.format_version = 99;
          },
          true,
        ),
      ],
      [
        "referencias",
        // Un evento que apunta al calendario real de Bob.
        await tampered(
          alice.client,
          (file) => {
            firstEvent(file).calendarId = bobCalendar?.id ?? "";
          },
          true,
        ),
      ],
    ];
    for (const [expected, body] of cases) {
      const result = await restoreFrom(alice.client, () =>
        upload(alice.client, "/api/restores/upload", body, "copia.json"),
      );
      expect(result.status, expected).toBe("failed");
      expect(result.error?.toLowerCase(), expected).toContain(expected);
    }
    // Nada de Bob ha cambiado.
    expect(await fingerprint(bobId)).toEqual(bobBefore);
  });

  it("un adjunto alterado dentro del zip no se restaura", async () => {
    const { client } = await registerUser();
    await seed(client);
    const backup = await createBackup(client);
    const download = await client.get(`/api/backups/${backup?.id ?? ""}/download`);
    const files = unzipSync(new Uint8Array(await download.arrayBuffer()));
    const name = Object.keys(files).find((n) => n.startsWith("attachments/")) ?? "";
    files[name] = new Uint8Array([1, 2, 3]);
    const ready = await restoreFrom(client, () =>
      upload(client, "/api/restores/upload", zipSync(files), "copia.zip"),
    );
    expect(ready.status).toBe("ready");
    expect(ready.counts?.attachments).toBe(0);
    expect(ready.warnings.join()).toContain("adjuntos");
  });

  it("rechaza ficheros que no son copias o demasiado grandes", async () => {
    const { client } = await registerUser();
    expect((await upload(client, "/api/restores/upload", PNG, "foto.png")).status).toBe(415);
    const big = await exports.default.fetch(
      new Request("https://delyra.test/api/restores/upload", {
        method: "POST",
        headers: {
          "cf-connecting-ip": client.ip,
          Origin: ORIGIN,
          "Content-Type": "application/zip",
          "Content-Length": String(300 * 1024 * 1024),
          "X-Filename": "grande.zip",
          Cookie: `__Secure-sid=${client.cookie ?? ""}`,
        },
        body: new Uint8Array(10),
      }),
    );
    expect(big.status).toBe(413);
    const notBackup = await restoreFrom(client, () =>
      upload(client, "/api/restores/upload", new TextEncoder().encode('{"hola":1}'), "x.json"),
    );
    expect(notBackup.status).toBe("failed");
    expect(notBackup.error).toContain("no es una copia");
  });
});

describe("copias automáticas y retención (F6-03)", () => {
  it("el cron crea la copia automática a quien le toca y se conservan N", async () => {
    const { client } = await registerUser();
    const ownerId = await me(client);
    expect(
      (await client.request("PUT", "/api/backups/settings", { frequency: "daily", keep: 2 }))
        .status,
    ).toBe(200);
    const db = createDb(env.DB);
    const introspector = await introspectWorkflow(env.BACKUP_WORKFLOW);
    try {
      await scheduleAutoBackups(env, Date.now(), createLogger({}));
      for (const instance of await introspector.get()) await instance.waitForStatus("complete");
    } finally {
      await introspector.dispose();
    }
    const repo = backupRepository(db, ownerId);
    expect(
      (await repo.list()).filter((b) => b.kind === "auto" && b.status === "ready"),
    ).toHaveLength(1);
    // Al día siguiente no se repite hasta que toca.
    expect(await scheduleAutoBackups(env, Date.now() + 3_600_000, createLogger({}))).toBe(0);

    // Retención: con 3 copias y keep=2, la más antigua se borra (fila y fichero).
    for (let i = 0; i < 2; i++) {
      const row = await repo.create("auto", new Date(Date.now() + (i + 1) * 1000));
      await env.BACKUPS.put(row.r2Key, "x");
      await repo.update(row.id, { status: "ready" });
    }
    const removed = await pruneBackups(db, env.BACKUPS, ownerId, "auto", 2);
    expect(removed).toBe(1);
    expect((await repo.list()).filter((b) => b.kind === "auto")).toHaveLength(2);
  });

  it("los niveles semanal y mensual del backup del sistema (F6-08)", () => {
    expect(tierKeys("2026-11-22")).toEqual(["system/weekly/2026-11-22.sql"]);
    expect(tierKeys("2026-11-01")).toEqual([
      "system/weekly/2026-11-01.sql",
      "system/monthly/2026-11.sql",
    ]);
    expect(tierKeys("2026-12-01")).toEqual(["system/monthly/2026-12.sql"]);
    expect(tierKeys("2026-11-23")).toEqual([]);
  });
});

describe("exportaciones sueltas (F6-02)", () => {
  it("el ICS de un calendario se vuelve a leer igual (serie, excepción, borrado y alertas)", async () => {
    const { client } = await registerUser();
    const { personal } = await seed(client);
    const response = await client.get(`/api/calendars/${personal?.id ?? ""}/export`);
    expect(response.headers.get("content-type")).toContain("text/calendar");
    const parsed = parseIcs(await response.text(), { defaultTimeZone: "Europe/Madrid" });
    const master = parsed.events.find((e) => e.recurrenceId === null);
    expect(master).toMatchObject({
      title: "Clase semanal",
      notes: "Con notas",
      startAt: Date.parse("2027-03-01T09:00:00Z"),
      rrule: "FREQ=WEEKLY;COUNT=6",
      exdates: [Date.parse("2027-03-15T09:00:00Z")],
      reminders: [30],
    });
    expect(parsed.events.find((e) => e.recurrenceId !== null)).toMatchObject({
      title: "Clase movida",
      recurrenceId: Date.parse("2027-03-08T09:00:00Z"),
      startAt: Date.parse("2027-03-08T11:00:00Z"),
    });
  });

  it("CSV del tablero sin inyección de fórmulas y JSON legible", async () => {
    const { client } = await registerUser();
    const { board, card } = await seed(client);
    await client.request("PATCH", `/api/cards/${card.id}`, { title: '=HYPERLINK("http://x")' });
    const csv = await (await client.get(`/api/boards/${board.board.id}/export?format=csv`)).text();
    expect(csv).toContain("'=HYPERLINK");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    const data = await json<{ format: string; columns: { cards: { labels: string[] }[] }[] }>(
      client.get(`/api/boards/${board.board.id}/export?format=json`),
    );
    expect(data.format).toBe("delyra-board");
    expect(data.columns.flatMap((c) => c.cards)[0]?.labels).toEqual(["Urgente"]);
  });
});

describe("backups del sistema en el panel de admin (F6-06)", () => {
  it("solo un administrador los ve y puede lanzar uno", async () => {
    const admin = await registerUser("admin");
    const member = await registerUser();
    expect((await member.client.get("/api/admin/backups")).status).toBe(404);
    await env.BACKUPS.put("system/daily/2026-11-21.sql", "-- volcado");
    const list = await json<{ objects: { key: string; tier: string }[] }>(
      admin.client.get("/api/admin/backups"),
    );
    expect(list.objects).toContainEqual(
      expect.objectContaining({ key: "system/daily/2026-11-21.sql", tier: "daily" }),
    );
    const introspector = await introspectWorkflow(env.SYSTEM_BACKUP);
    try {
      await introspector.modifyAll(async (m) => {
        await m.mockStepResult({ name: "iniciar exportación de D1" }, "bookmark");
        await m.mockStepResult(
          { name: "esperar volcado y guardarlo en R2" },
          { sizeBytes: 10, etag: "e" },
        );
        await m.mockStepResult({ name: "copias semanal y mensual" }, []);
      });
      const response = await admin.client.post("/api/admin/backups");
      expect(response.status).toBe(202);
      const [instance] = await introspector.get();
      await instance?.waitForStatus("complete");
    } finally {
      await introspector.dispose();
    }
  });
});
