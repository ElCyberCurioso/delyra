import type { BoardDetail, CardDetail } from "@delyra/shared";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { contentDisposition, sanitizeFilename, sniffType } from "../src/services/attachments";
import { ORIGIN, registerUser, type TestClient } from "./helpers";

/** Adjuntos (F4-06, F4-12): tipo real, tamaño, nombres con rutas y descarga autenticada. */

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const text = (value: string) => new TextEncoder().encode(value);

interface UploadOptions {
  type?: string;
  filename?: string | null;
  length?: string;
  origin?: string | null;
}

async function upload(
  client: TestClient,
  cardId: string,
  body: Uint8Array,
  { type = "image/png", filename = "foto.png", length, origin = ORIGIN }: UploadOptions = {},
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
    new Request(`https://delyra.test/api/cards/${cardId}/attachments`, {
      method: "POST",
      headers,
      body,
    }),
  );
}

async function cardFor(client: TestClient) {
  const response = await client.post("/api/boards", { name: "Adjuntos", template: "personal" });
  const detail = await response.json<BoardDetail>();
  const created = await client.post(`/api/columns/${detail.columns[0]?.id ?? ""}/cards`, {
    title: "Con ficheros",
  });
  return { board: detail, card: (await created.json<{ card: CardDetail }>()).card };
}

async function objectsUnder(prefix: string) {
  return (await env.ATTACHMENTS.list({ prefix })).objects.map((o) => o.key);
}

describe("detección de tipo y nombres (F4-06)", () => {
  it("reconoce el tipo por su contenido, no por lo que dice el cliente", () => {
    expect(sniffType(PNG, "image/png")).toBe("image/png");
    expect(sniffType(PNG, "application/pdf")).toBe("image/png");
    expect(sniffType(text("%PDF-1.7\n"), "application/pdf")).toBe("application/pdf");
    expect(sniffType(text("<html><script>alert(1)</script>"), "image/png")).toBeNull();
    expect(sniffType(text("  <!DOCTYPE html><p>hola"), "text/plain")).toBeNull();
    expect(sniffType(text("<svg onload=alert(1)>"), "text/plain")).toBeNull();
    expect(sniffType(text("MZ\u0090\u0000ejecutable"), "application/pdf")).toBeNull();
    expect(sniffType(new Uint8Array([0x68, 0x00, 0x69]), "text/plain")).toBeNull();
    expect(sniffType(text("fecha,importe\n2027-01-01,10\n"), "text/csv")).toBe("text/csv");
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    expect(sniffType(zip, docx)).toBe(docx);
    expect(sniffType(zip, "text/html")).toBe("application/zip");
  });

  it("limpia rutas, caracteres reservados y nombres demasiado largos", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("C:\\Windows\\system32\\evil.exe")).toBe("evil.exe");
    expect(sanitizeFilename('in<fo>r:m"e|?*.pdf')).toBe("in_fo_r_m_e___.pdf");
    expect(sanitizeFilename("nombre\u0000\u001b[31m.txt")).toBe("nombre[31m.txt");
    expect(sanitizeFilename("...")).toBe("adjunto");
    expect(sanitizeFilename("  .oculto  ")).toBe("oculto");
    const long = sanitizeFilename(`${"a".repeat(200)}.pdf`);
    expect(long).toHaveLength(120);
    expect(long.endsWith(".pdf")).toBe(true);
  });

  it("Content-Disposition siempre como descarga y con el nombre escapado", () => {
    expect(contentDisposition('informe "final".pdf')).toBe(
      `attachment; filename="informe _final_.pdf"; filename*=UTF-8''informe%20%22final%22.pdf`,
    );
    expect(contentDisposition("año.txt")).toContain("filename*=UTF-8''a%C3%B1o.txt");
  });
});

describe("subida y descarga (F4-06)", () => {
  it("sube en streaming, guarda el nombre limpio y solo el dueño descarga", async () => {
    const { client } = await registerUser();
    const { board, card } = await cardFor(client);
    const response = await upload(client, card.id, PNG, { filename: "../../secretos/foto.png" });
    expect(response.status).toBe(201);
    const { card: updated } = await response.json<{ card: CardDetail }>();
    const [attachment] = updated.attachmentList;
    expect(attachment).toMatchObject({
      filename: "foto.png",
      contentType: "image/png",
      size: PNG.byteLength,
    });
    expect(updated.attachments).toBe(1);
    expect(updated.activity.map((a) => a.kind)).toContain("attached");

    const download = await client.get(`/api/attachments/${attachment?.id ?? ""}`);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toMatch(/^attachment; filename="foto.png"/);
    expect(download.headers.get("x-content-type-options")).toBe("nosniff");
    expect(download.headers.get("cache-control")).toBe("private, no-store");
    expect(download.headers.get("content-security-policy")).toContain("sandbox");
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(PNG);

    const other = await registerUser();
    expect((await other.client.get(`/api/attachments/${attachment?.id ?? ""}`)).status).toBe(404);
    expect((await other.client.delete(`/api/attachments/${attachment?.id ?? ""}`)).status).toBe(
      404,
    );
    expect((await upload(other.client, card.id, PNG)).status).toBe(404);
    const owner = await client.get("/api/auth/me");
    const { user } = await owner.json<{ user: { id: string } }>();
    expect(await objectsUnder(`boards/${user.id}/${board.board.id}/`)).toHaveLength(1);
  });

  it("rechaza tipos falsos, ficheros grandes y peticiones sin cabeceras", async () => {
    const { client } = await registerUser();
    const { card } = await cardFor(client);
    const html = text("<html><body><script>alert(document.cookie)</script></body></html>");
    expect((await upload(client, card.id, html, { type: "image/png" })).status).toBe(415);
    expect((await upload(client, card.id, html, { type: "text/plain" })).status).toBe(415);
    expect(
      (await upload(client, card.id, text("MZ ejecutable"), { type: "application/pdf" })).status,
    ).toBe(415);
    expect(
      (await upload(client, card.id, text("<svg/onload=alert(1)>"), { type: "image/svg+xml" }))
        .status,
    ).toBe(415);
    // El tamaño se comprueba antes de leer nada.
    expect(
      (await upload(client, card.id, PNG, { length: String(10 * 1024 * 1024 + 1) })).status,
    ).toBe(413);
    // Sin el nombre (o sin Origin) ni siquiera llega a la ruta.
    expect((await upload(client, card.id, PNG, { filename: null })).status).toBe(415);
    expect((await upload(client, card.id, PNG, { origin: null })).status).toBe(403);
    expect((await upload(client, card.id, PNG, { origin: "https://evil.example" })).status).toBe(
      403,
    );

    const detail = await client.get(`/api/cards/${card.id}`);
    expect((await detail.json<{ card: CardDetail }>()).card.attachmentList).toHaveLength(0);
  });

  it("sin sesión responde 401", async () => {
    const { client } = await registerUser();
    const { card } = await cardFor(client);
    const anonymous = await upload(
      Object.assign(Object.create(client) as TestClient, { cookie: null }),
      card.id,
      PNG,
    );
    expect(anonymous.status).toBe(401);
  });

  it("al borrar el adjunto, la tarjeta o el tablero se borran los ficheros de R2", async () => {
    const { client } = await registerUser();
    const { user } = await (await client.get("/api/auth/me")).json<{ user: { id: string } }>();
    const { board, card } = await cardFor(client);
    const prefix = `boards/${user.id}/${board.board.id}/`;

    const first = await (await upload(client, card.id, PNG)).json<{ card: CardDetail }>();
    await upload(client, card.id, text("hola"), { type: "text/plain", filename: "nota.txt" });
    expect(await objectsUnder(prefix)).toHaveLength(2);

    const one = first.card.attachmentList[0]?.id ?? "";
    expect((await client.delete(`/api/attachments/${one}`)).status).toBe(200);
    expect(await objectsUnder(prefix)).toHaveLength(1);

    expect((await client.delete(`/api/cards/${card.id}`)).status).toBe(204);
    expect(await objectsUnder(prefix)).toHaveLength(0);

    const second = await client.post(`/api/columns/${board.columns[1]?.id ?? ""}/cards`, {
      title: "Otra",
    });
    const other = (await second.json<{ card: CardDetail }>()).card;
    await upload(client, other.id, PNG);
    expect(await objectsUnder(prefix)).toHaveLength(1);
    expect((await client.delete(`/api/boards/${board.board.id}`)).status).toBe(204);
    expect(await objectsUnder(prefix)).toHaveLength(0);
  });
});
