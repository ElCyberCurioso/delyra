import type { BoardDetail, CardDetail, MicrosoftBoardInfo } from "@delyra/shared";
import { env, exports } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDb } from "../src/db/client";
import { microsoftConnections } from "../src/db/schema";
import { keyringFromEnv } from "../src/lib/field-crypto";
import { createLogger } from "../src/lib/logger";
import {
  type GraphEvent,
  MICROSOFT_OAUTH_COOKIE,
  microsoftConfig,
} from "../src/services/microsoft";
import { syncDueMicrosoftBoards } from "../src/services/microsoft-sync";
import { registerUser, type TestClient } from "./helpers";

/** Reuniones de Teams en un tablero (docs/plan-teams.md, ADR-0015). */

vi.setConfig({ testTimeout: 30_000 });

const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const JOIN = "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0";

/** «2026-11-24T10:00:00.0000000», como lo da Graph con `outlook.timezone="UTC"`. */
function graphTime(ms: number) {
  return { dateTime: new Date(ms).toISOString().replace("Z", "0000"), timeZone: "UTC" };
}

function meeting(id: string, subject: string, startMs: number, extra: Partial<GraphEvent> = {}) {
  return {
    id,
    subject,
    start: graphTime(startMs),
    end: graphTime(startMs + 3_600_000),
    isAllDay: false,
    isCancelled: false,
    isOnlineMeeting: true,
    onlineMeeting: { joinUrl: JOIN },
    location: { displayName: "Sala 3" },
    organizer: { emailAddress: { name: "Ana López" } },
    ...extra,
  } satisfies GraphEvent;
}

interface FakeMicrosoft {
  events: GraphEvent[];
  revoked: boolean;
  /** Tokens de acceso que ya no valen (401 en Graph). */
  expired: Set<string>;
  refreshTokens: string[];
  calls: { token: URLSearchParams[]; graph: string[] };
}

function fakeMicrosoft(): FakeMicrosoft {
  const now = Date.now();
  const state: FakeMicrosoft = {
    events: [
      meeting("m1", "Revisión del sprint", now + 2 * 86_400_000),
      meeting("m2", "Comida con el equipo", now + 3 * 86_400_000, {
        isOnlineMeeting: false,
        onlineMeeting: null,
      }),
    ],
    revoked: false,
    expired: new Set(),
    refreshTokens: [],
    calls: { token: [], graph: [] },
  };
  let issued = 0;
  const valid = new Set<string>();
  const issue = () => {
    issued++;
    const access = `ms-acceso-${String(issued)}`;
    const refresh = `ms-refresh-${String(issued)}`;
    valid.add(access);
    state.refreshTokens.push(refresh);
    return Response.json({
      access_token: access,
      refresh_token: refresh,
      expires_in: 3599,
      scope: "https://graph.microsoft.com/Calendars.Read https://graph.microsoft.com/User.Read",
    });
  };
  const original = globalThis.fetch.bind(globalThis);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    if (url.href === TOKEN_URL) {
      const body = new URLSearchParams(init?.body as string);
      state.calls.token.push(body);
      if (body.get("grant_type") === "refresh_token") {
        if (state.revoked) return Response.json({ error: "invalid_grant" }, { status: 400 });
        // Rotación: solo vale el último token de actualización entregado.
        if (body.get("refresh_token") !== state.refreshTokens.at(-1)) {
          return Response.json({ error: "invalid_grant" }, { status: 400 });
        }
      }
      return issue();
    }
    if (url.origin === "https://graph.microsoft.com") {
      state.calls.graph.push(url.pathname);
      const token = new Headers(init?.headers).get("authorization")?.replace("Bearer ", "") ?? "";
      if (state.revoked || !valid.has(token) || state.expired.has(token)) {
        return Response.json({}, { status: 401 });
      }
      if (url.pathname === "/v1.0/me") return Response.json({ mail: "ana@contoso.com" });
      if (url.pathname === "/v1.0/me/calendarView") {
        return Response.json({ value: state.events });
      }
      const eventsPrefix = "/v1.0/me/events/";
      if (url.pathname.startsWith(eventsPrefix)) {
        const id = decodeURIComponent(url.pathname.slice(eventsPrefix.length));
        const found = state.events.find((e) => e.id === id);
        return found ? Response.json(found) : Response.json({}, { status: 404 });
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

async function newBoard(client: TestClient) {
  const res = await client.post("/api/boards", { name: "Reuniones", template: "personal" });
  expect(res.status).toBe(201);
  return res.json<BoardDetail>();
}

function callback(client: TestClient, query: string, cookie: string) {
  return exports.default.fetch(
    new Request(`https://delyra.test/api/microsoft/callback?${query}`, {
      headers: {
        "cf-connecting-ip": client.ip,
        Cookie: `__Secure-sid=${client.cookie ?? ""}; ${MICROSOFT_OAUTH_COOKIE}=${cookie}`,
      },
      redirect: "manual",
    }),
  );
}

async function connect(client: TestClient, boardId: string, tamper = false) {
  const res = await client.post("/api/microsoft/authorize", { boardId });
  expect(res.status).toBe(200);
  const { url } = await res.json<{ url: string }>();
  const setCookie = res.headers.get("set-cookie") ?? "";
  const at = setCookie.indexOf(`${MICROSOFT_OAUTH_COOKIE}=`);
  const cookie =
    at < 0 ? "" : setCookie.slice(at + MICROSOFT_OAUTH_COOKIE.length + 1).split(";")[0];
  const state = new URL(url).searchParams.get("state") ?? "";
  const back = await callback(
    client,
    `code=codigo&state=${tamper ? "otro-state" : state}`,
    cookie ?? "",
  );
  return { authorizeUrl: new URL(url), location: back.headers.get("location") ?? "" };
}

async function info(client: TestClient, boardId: string) {
  return (await client.get(`/api/microsoft/boards/${boardId}`)).json<MicrosoftBoardInfo>();
}

async function waitSynced(client: TestClient, boardId: string) {
  for (let i = 0; i < 50; i++) {
    const current = await info(client, boardId);
    if (current.sync && current.sync.status !== "pending") return current;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("El primer volcado no terminó");
}

async function runScheduler(minutesLater: number) {
  return syncDueMicrosoftBoards(
    createDb(env.DB),
    await keyringFromEnv(env),
    microsoftConfig(env),
    Date.now() + minutesLater * 60_000,
    createLogger({ test: "microsoft" }),
    () => Promise.resolve(),
    50,
  );
}

async function setup() {
  const microsoft = fakeMicrosoft();
  const account = await registerUser();
  const detail = await newBoard(account.client);
  const columnId = detail.columns[0]?.id ?? "";
  await connect(account.client, detail.board.id);
  const put = await account.client.request("PUT", `/api/microsoft/boards/${detail.board.id}`, {
    columnId,
  });
  expect(put.status).toBe(200);
  await waitSynced(account.client, detail.board.id);
  return { microsoft, ...account, boardId: detail.board.id, columnId };
}

async function boardCards(client: TestClient, boardId: string) {
  return (await (await client.get(`/api/boards/${boardId}`)).json<BoardDetail>()).cards;
}

async function cardDetail(client: TestClient, id: string) {
  return (await (await client.get(`/api/cards/${id}`)).json<{ card: CardDetail }>()).card;
}

describe("conexión con Microsoft 365", () => {
  it("pide solo lectura del calendario, guarda los tokens cifrados y vuelve al tablero", async () => {
    const microsoft = fakeMicrosoft();
    const { client } = await registerUser();
    const { board } = await newBoard(client);
    expect(await info(client, board.id)).toEqual({ enabled: true, connection: null, sync: null });

    const { authorizeUrl, location } = await connect(client, board.id);
    expect(authorizeUrl.origin + authorizeUrl.pathname).toBe(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    );
    expect(Object.fromEntries(authorizeUrl.searchParams)).toMatchObject({
      scope: "offline_access User.Read Calendars.Read",
      redirect_uri: "http://localhost:5174/api/microsoft/callback",
      code_challenge_method: "S256",
      response_type: "code",
    });
    expect(location).toBe(`/tableros/${board.id}?microsoft=conectada`);
    expect(microsoft.calls.token[0]?.get("code_verifier")?.length).toBeGreaterThanOrEqual(43);

    const current = await info(client, board.id);
    expect(current.connection).toEqual({ email: "ana@contoso.com", status: "ok" });
    const me = await (await client.get("/api/auth/me")).json<{ user: { id: string } }>();
    const [row] = await createDb(env.DB)
      .select()
      .from(microsoftConnections)
      .where(eq(microsoftConnections.ownerId, me.user.id));
    expect(row?.refreshTokenEnc).toMatch(/^v1:/);
    expect(row?.refreshTokenEnc).not.toContain("ms-refresh");
  });

  it("rechaza un state manipulado sin canjear el código", async () => {
    const microsoft = fakeMicrosoft();
    const { client } = await registerUser();
    const { board } = await newBoard(client);
    const { location } = await connect(client, board.id, true);
    expect(location).toBe(`/tableros/${board.id}?microsoft=state`);
    expect(microsoft.calls.token).toHaveLength(0);
    expect((await info(client, board.id)).connection).toBeNull();
  });

  it("sin acceso de edición al tablero no se puede conectar ni configurar", async () => {
    fakeMicrosoft();
    const owner = await registerUser();
    const other = await registerUser();
    const { board, columns } = await newBoard(owner.client);
    expect(
      (await other.client.post("/api/microsoft/authorize", { boardId: board.id })).status,
    ).toBe(404);
    expect((await other.client.get(`/api/microsoft/boards/${board.id}`)).status).toBe(404);
    expect(
      (
        await other.client.request("PUT", `/api/microsoft/boards/${board.id}`, {
          columnId: columns[0]?.id,
        })
      ).status,
    ).toBe(404);
  });
});

describe("volcado de reuniones al tablero", () => {
  it("crea una tarjeta por reunión de Teams con fecha, enlace y etiqueta", async () => {
    const { client, boardId, columnId } = await setup();
    const status = await info(client, boardId);
    expect(status.sync).toMatchObject({ mine: true, status: "ok", cards: 1, onlyTeams: true });

    const cards = await boardCards(client, boardId);
    expect(cards.map((c) => c.title)).toEqual(["Revisión del sprint"]);
    const [card] = cards;
    expect(card?.columnId).toBe(columnId);
    expect(card?.due?.allDay).toBe(false);
    const detail = await cardDetail(client, card?.id ?? "");
    expect(detail.description).toContain(`[Unirse a la reunión](${JOIN})`);
    expect(detail.description).toContain("Organiza: Ana López");
    const board = await (await client.get(`/api/boards/${boardId}`)).json<BoardDetail>();
    const teams = board.labels.find((l) => l.name === "Teams");
    expect(card?.labelIds).toEqual([teams?.id]);
  });

  it("actualiza lo que cambia en Outlook pero respeta lo que se edita en la tarjeta", async () => {
    const { microsoft, client, boardId } = await setup();
    const [card] = await boardCards(client, boardId);
    const id = card?.id ?? "";
    // La persona añade sus notas a la descripción.
    const own = `${(await cardDetail(client, id)).description}\n\nMis notas`;
    expect((await client.request("PATCH", `/api/cards/${id}`, { description: own })).status).toBe(
      200,
    );

    const later = Date.now() + 4 * 86_400_000;
    microsoft.events[0] = meeting("m1", "Revisión del sprint 12", later, {
      location: { displayName: "Sala 5" },
    });
    await runScheduler(16);
    const updated = await cardDetail(client, id);
    expect(updated.title).toBe("Revisión del sprint 12");
    expect(Date.parse(updated.due?.at ?? "")).toBe(later);
    expect(updated.description).toBe(own);
  });

  it("archiva las reuniones canceladas y las borradas", async () => {
    const { microsoft, client, boardId } = await setup();
    microsoft.events.push(meeting("m3", "Demo con cliente", Date.now() + 5 * 86_400_000));
    await runScheduler(16);
    const before = await boardCards(client, boardId);
    expect(before.map((c) => c.title).sort()).toEqual(["Demo con cliente", "Revisión del sprint"]);

    microsoft.events[0] = { ...microsoft.events[0], id: "m1", isCancelled: true };
    microsoft.events = microsoft.events.filter((e) => e.id !== "m3");
    await runScheduler(32);
    expect(await boardCards(client, boardId)).toEqual([]);
    for (const card of before) {
      expect((await cardDetail(client, card.id)).archivedAt).not.toBeNull();
    }
    expect((await info(client, boardId)).sync?.cards).toBe(0);
  });

  it("guarda el token de actualización nuevo en cada renovación", async () => {
    const { microsoft, client, boardId } = await setup();
    microsoft.expired.add("ms-acceso-1");
    await runScheduler(16);
    microsoft.expired.add("ms-acceso-2");
    await runScheduler(32);
    const refreshes = microsoft.calls.token
      .filter((t) => t.get("grant_type") === "refresh_token")
      .map((t) => t.get("refresh_token"));
    expect(refreshes).toEqual(["ms-refresh-1", "ms-refresh-2"]);
    expect((await info(client, boardId)).sync?.status).toBe("ok");
  });

  it("si Microsoft retira el permiso, queda revocada hasta reconectar", async () => {
    const { microsoft, client, boardId } = await setup();
    microsoft.revoked = true;
    await runScheduler(16);
    const revoked = await info(client, boardId);
    expect(revoked.connection?.status).toBe("revoked");
    expect(revoked.sync).toMatchObject({
      status: "error",
      error: "Microsoft ha retirado el permiso de Delyra. Vuelve a conectar tu cuenta.",
    });
    microsoft.revoked = false;
    await connect(client, boardId);
    expect((await info(client, boardId)).connection?.status).toBe("ok");
  });

  it("un tablero solo recibe las reuniones de una persona; desconectar no borra tarjetas", async () => {
    const { client, boardId, columnId } = await setup();
    // Otra persona con permiso de edición no puede quitarle el volcado.
    const editor = await registerUser();
    const me = await (await editor.client.get("/api/auth/me")).json<{ user: { email: string } }>();
    await client.post(`/api/boards/${boardId}/invitations`, {
      email: me.user.email,
      role: "editor",
    });
    const invitations = await (
      await editor.client.get("/api/board-invitations")
    ).json<{
      invitations: { id: string }[];
    }>();
    await editor.client.post(
      `/api/board-invitations/${invitations.invitations[0]?.id ?? ""}/accept`,
    );
    await connect(editor.client, boardId);
    expect(
      (await editor.client.request("PUT", `/api/microsoft/boards/${boardId}`, { columnId })).status,
    ).toBe(409);
    expect((await editor.client.delete(`/api/microsoft/boards/${boardId}`)).status).toBe(403);

    expect((await client.delete("/api/microsoft/connection")).status).toBe(204);
    const after = await info(client, boardId);
    expect(after.connection).toBeNull();
    expect(after.sync).toBeNull();
    expect((await boardCards(client, boardId)).map((c) => c.title)).toEqual([
      "Revisión del sprint",
    ]);
  });

  it("no toma por Teams enlaces de otros dominios", async () => {
    const microsoft = fakeMicrosoft();
    microsoft.events = [
      meeting("x1", "Phishing", Date.now() + 86_400_000, {
        onlineMeeting: { joinUrl: "https://teams.microsoft.com.evil.example/l/meetup-join/1" },
      }),
    ];
    const { client } = await registerUser();
    const detail = await newBoard(client);
    await connect(client, detail.board.id);
    await client.request("PUT", `/api/microsoft/boards/${detail.board.id}`, {
      columnId: detail.columns[0]?.id,
      onlyTeams: false,
    });
    await waitSynced(client, detail.board.id);
    const [card] = await boardCards(client, detail.board.id);
    const description = (await cardDetail(client, card?.id ?? "")).description;
    expect(description).toContain("Evento de Outlook");
    expect(description).not.toContain("evil.example");
  });
});
