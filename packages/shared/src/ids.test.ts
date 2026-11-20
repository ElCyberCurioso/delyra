import { describe, expect, it } from "vitest";
import { idSchema, idTimestamp, newId } from "./ids";

describe("newId", () => {
  it("genera UUIDv7 válidos y únicos", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId()));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(idSchema.safeParse(id).success).toBe(true);
  });

  it("genera identificadores ordenables por tiempo", () => {
    const ids = Array.from({ length: 50 }, () => newId());
    expect([...ids].sort()).toEqual(ids);
  });
});

describe("idSchema", () => {
  it("rechaza UUID de otras versiones y cadenas arbitrarias", () => {
    expect(idSchema.safeParse("550e8400-e29b-41d4-a716-446655440000").success).toBe(false);
    expect(idSchema.safeParse("1 OR 1=1").success).toBe(false);
  });
});

describe("idTimestamp", () => {
  it("extrae el instante de creación", () => {
    const before = Date.now();
    const id = newId();
    const after = Date.now();
    const ts = idTimestamp(id).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});
