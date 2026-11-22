import type { BoardDetail, CardSummary } from "@delyra/shared";
import { describe, expect, it } from "vitest";
import {
  cardIdsByColumn,
  dueLabel,
  dueThisWeek,
  fromLocalInput,
  isOverdue,
  matchesFilters,
  moveCardLocally,
  moveColumnLocally,
  serverIndex,
  sortedColumns,
  toLocalInput,
} from "./logic";
import { renderMarkdown } from "./markdown";

const TZ = "Europe/Madrid";
const NOW = Date.parse("2027-05-10T10:00:00Z"); // lunes 12:00 en Madrid

function card(id: string, columnId: string, position: string, extra: Partial<CardSummary> = {}) {
  return {
    id,
    columnId,
    title: id,
    position,
    priority: "none",
    due: null,
    completedAt: null,
    archivedAt: null,
    labelIds: [],
    checklist: { done: 0, total: 0 },
    comments: 0,
    attachments: 0,
    hasDescription: false,
    ...extra,
  } satisfies CardSummary;
}

const board: BoardDetail = {
  board: {
    id: "b",
    name: "Tablero",
    template: "personal",
    autoarchiveDays: 14,
    openCards: 3,
    createdAt: "2027-01-01T00:00:00.000Z",
  },
  columns: [
    { id: "done", name: "Hecho", position: "a2", wipLimit: null, isDone: true },
    { id: "todo", name: "Por hacer", position: "a0", wipLimit: null, isDone: false },
    { id: "doing", name: "Haciendo", position: "a1", wipLimit: 3, isDone: false },
  ],
  cards: [card("B", "todo", "a1"), card("A", "todo", "a0"), card("C", "doing", "a0")],
  labels: [],
};

describe("orden y movimientos optimistas", () => {
  it("ordena columnas y tarjetas por posición", () => {
    expect(sortedColumns(board).map((c) => c.id)).toEqual(["todo", "doing", "done"]);
    expect(cardIdsByColumn(board)).toEqual({ done: [], todo: ["A", "B"], doing: ["C"] });
  });

  it("mueve una tarjeta y marca completed_at al entrar en la columna hecha", () => {
    const moved = moveCardLocally(board, "B", "doing", 0);
    expect(cardIdsByColumn(moved).doing).toEqual(["B", "C"]);
    expect(cardIdsByColumn(moved).todo).toEqual(["A"]);
    const done = moveCardLocally(board, "A", "done", 0, new Date(NOW));
    expect(done.cards.find((c) => c.id === "A")?.completedAt).toBe(new Date(NOW).toISOString());
    const back = moveCardLocally(done, "A", "todo", 5);
    expect(back.cards.find((c) => c.id === "A")?.completedAt).toBeNull();
    expect(cardIdsByColumn(back).todo).toEqual(["B", "A"]);
  });

  it("reordena columnas", () => {
    expect(sortedColumns(moveColumnLocally(board, "done", 0)).map((c) => c.id)).toEqual([
      "done",
      "todo",
      "doing",
    ]);
  });

  it("traduce el índice visible (con filtros) al de la columna completa", () => {
    const full = ["A", "B", "C", "D"];
    // Visibles A y D; se suelta X entre ellas → justo antes de D.
    expect(serverIndex(full, ["A", "X", "D"], "X")).toBe(3);
    expect(serverIndex(full, ["X", "A", "D"], "X")).toBe(0);
    expect(serverIndex(full, ["A", "D", "X"], "X")).toBe(4);
    // La propia tarjeta movida dentro de su columna.
    expect(serverIndex(full, ["B", "A", "C", "D"], "A")).toBe(1);
    expect(serverIndex(full, ["A"], "A")).toBe(0);
    expect(serverIndex([], ["X"], "X")).toBe(0);
  });
});

describe("fechas límite", () => {
  const timed = (at: string) => card("t", "todo", "a0", { due: { allDay: false, at, tz: TZ } });
  const allDay = (at: string) => card("d", "todo", "a0", { due: { allDay: true, at, tz: TZ } });

  it("vencida según la hora o el día local", () => {
    expect(isOverdue(timed("2027-05-10T09:59:00Z"), NOW, TZ)).toBe(true);
    expect(isOverdue(timed("2027-05-10T10:01:00Z"), NOW, TZ)).toBe(false);
    expect(isOverdue(allDay("2027-05-09"), NOW, TZ)).toBe(true);
    expect(isOverdue(allDay("2027-05-10"), NOW, TZ)).toBe(false);
    expect(
      isOverdue({ ...allDay("2027-05-01"), completedAt: "2027-05-02T00:00:00Z" }, NOW, TZ),
    ).toBe(false);
  });

  it("esta semana = hoy y los 6 días siguientes", () => {
    expect(dueThisWeek(allDay("2027-05-10"), NOW, TZ)).toBe(true);
    expect(dueThisWeek(allDay("2027-05-16"), NOW, TZ)).toBe(true);
    expect(dueThisWeek(allDay("2027-05-17"), NOW, TZ)).toBe(false);
    expect(dueThisWeek(allDay("2027-05-09"), NOW, TZ)).toBe(false);
  });

  it("etiquetas legibles en la zona del usuario", () => {
    expect(dueLabel({ allDay: true, at: "2027-05-10", tz: TZ }, TZ, NOW)).toBe("Hoy");
    expect(dueLabel({ allDay: false, at: "2027-05-11T15:00:00Z", tz: TZ }, TZ, NOW)).toBe(
      "Mañana 17:00",
    );
    expect(dueLabel({ allDay: true, at: "2027-05-09", tz: TZ }, TZ, NOW)).toBe("Ayer");
    expect(dueLabel({ allDay: true, at: "2027-06-03", tz: TZ }, TZ, NOW)).toBe("3 jun");
    expect(dueLabel({ allDay: true, at: "2028-01-03", tz: TZ }, TZ, NOW)).toMatch(/2028/);
  });

  it("convierte datetime-local de ida y vuelta en la zona del usuario", () => {
    expect(toLocalInput("2027-05-10T15:00:00.000Z", TZ)).toBe("2027-05-10T17:00");
    expect(fromLocalInput("2027-05-10T17:00", TZ)).toBe("2027-05-10T15:00:00.000Z");
    expect(fromLocalInput("2027-01-10T17:00", TZ)).toBe("2027-01-10T16:00:00.000Z");
    expect(fromLocalInput("no", TZ)).toBeNull();
  });
});

describe("filtros", () => {
  const cards = [
    card("Pagar la luz", "todo", "a0", { labelIds: ["casa"], priority: "high" }),
    card("Informe trimestral", "todo", "a1", {
      due: { allDay: true, at: "2027-05-08", tz: TZ },
    }),
    card("Llamar a Begoña", "todo", "a2", { due: { allDay: true, at: "2027-05-12", tz: TZ } }),
  ];
  const titles = (filters: Parameters<typeof matchesFilters>[1]) =>
    cards.filter((c) => matchesFilters(c, filters, NOW, TZ)).map((c) => c.title);

  it("combina búsqueda (sin tildes ni mayúsculas), etiqueta, prioridad y fecha", () => {
    expect(titles({})).toHaveLength(3);
    expect(titles({ q: "begona" })).toEqual(["Llamar a Begoña"]);
    expect(titles({ q: "  INFORME " })).toEqual(["Informe trimestral"]);
    expect(titles({ label: "casa" })).toEqual(["Pagar la luz"]);
    expect(titles({ priority: "high" })).toEqual(["Pagar la luz"]);
    expect(titles({ due: "overdue" })).toEqual(["Informe trimestral"]);
    expect(titles({ due: "week" })).toEqual(["Llamar a Begoña"]);
    expect(titles({ label: "casa", due: "week" })).toEqual([]);
  });
});

describe("Markdown saneado (F4-09)", () => {
  it("da formato y no deja pasar HTML ni enlaces peligrosos", () => {
    expect(renderMarkdown("**hola** _mundo_")).toBe(
      "<p><strong>hola</strong> <em>mundo</em></p>\n",
    );
    const html = renderMarkdown(
      [
        "<script>alert(1)</script>",
        '<img src=x onerror="alert(1)">',
        "[pulsa](javascript:alert(1))",
        "[bien](https://example.com)",
        "<a href='https://evil.example' onclick='x()'>raw</a>",
      ].join("\n\n"),
    );
    const dom = new DOMParser().parseFromString(html, "text/html").body;
    expect(dom.querySelectorAll("script, img, [onerror], [onclick]")).toHaveLength(0);
    const hrefs = [...dom.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    // Solo enlaces http(s): el `javascript:` no llega a ser enlace.
    expect(hrefs).toContain("https://example.com");
    for (const href of hrefs) expect(href).toMatch(/^https:\/\//);
    // El HTML escrito a mano se ve como texto, no se interpreta.
    expect(dom.textContent).toContain("<script>alert(1)</script>");
    expect(html).toContain(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer nofollow">bien</a>',
    );
  });

  it("convierte las URL sueltas en enlaces seguros", () => {
    expect(renderMarkdown("ver https://delyra.app")).toContain(
      'href="https://delyra.app" target="_blank" rel="noopener noreferrer nofollow"',
    );
  });
});
