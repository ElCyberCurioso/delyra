import { describe, expect, it } from "vitest";
import { evenKeys, keyAt, MAX_KEY_LENGTH, placeAt } from "../src/lib/positions";

const sortedIds = (items: { id: string; position: string }[]) =>
  [...items].sort((a, b) => (a.position < b.position ? -1 : 1)).map((i) => i.id);

describe("índices fraccionales (F4-02)", () => {
  it("inserta al principio, en medio y al final manteniendo el orden por bytes", () => {
    const [a, b] = evenKeys(2) as [string, string];
    expect(keyAt([], 0) < "z").toBe(true);
    expect(keyAt([a, b], 0) < a).toBe(true);
    const middle = keyAt([a, b], 1);
    expect(a < middle && middle < b).toBe(true);
    expect(keyAt([a, b], 2) > b).toBe(true);
    expect(keyAt([a, b], 99) > b).toBe(true);
  });

  it("mover un elemento solo cambia su clave", () => {
    const keys = evenKeys(4);
    const items = ["a", "b", "c", "d"].map((id, i) => ({ id, position: keys[i] ?? "" }));
    const changes = placeAt(items, "d", 1);
    expect([...changes.keys()]).toEqual(["d"]);
    const moved = items.map((i) => ({ ...i, position: changes.get(i.id) ?? i.position }));
    expect(sortedIds(moved)).toEqual(["a", "d", "b", "c"]);
  });

  it("reequilibra cuando la clave nueva crecería demasiado", () => {
    // Entre «a0» y «a000…0V» solo caben claves que empiezan por todos esos ceros.
    const items = [
      { id: "a", position: "a0" },
      { id: "b", position: `a0${"0".repeat(MAX_KEY_LENGTH)}V` },
      { id: "c", position: "a1" },
    ];
    const changes = placeAt(items, "d", 1);
    expect(changes.size).toBe(4);
    const all = [...items, { id: "d", position: "" }].map((i) => ({
      ...i,
      position: changes.get(i.id) ?? i.position,
    }));
    expect(sortedIds(all)).toEqual(["a", "d", "b", "c"]);
    expect(all.every((i) => i.position.length <= 3)).toBe(true);
  });

  it("muchas inserciones en el mismo hueco mantienen el orden y claves únicas", () => {
    let items = evenKeys(2).map((position, i) => ({ id: `x${String(i)}`, position }));
    for (let n = 0; n < 300; n++) {
      const id = `n${String(n)}`;
      const sorted = [...items].sort((a, b) => (a.position < b.position ? -1 : 1));
      const changes = placeAt(sorted, id, 1);
      items = [
        ...items.map((i) => ({ ...i, position: changes.get(i.id) ?? i.position })),
        { id, position: changes.get(id) ?? "" },
      ];
    }
    const order = sortedIds(items);
    expect(order.slice(0, 2)).toEqual(["x0", "n299"]);
    expect(order.at(-1)).toBe("x1");
    expect(new Set(items.map((i) => i.position)).size).toBe(items.length);
  });
});
