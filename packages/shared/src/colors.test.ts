import { describe, expect, it } from "vitest";
import {
  COLOR_PALETTE,
  inkOnWhite,
  readableColors,
  readableTextColor,
  relativeLuminance,
} from "./colors";

describe("colores", () => {
  it("el texto encima de cada color de la paleta cumple 4,5:1", () => {
    for (const { hex } of [...COLOR_PALETTE, { hex: "#808080" }, { hex: "#00ff00" }]) {
      const { background, text } = readableColors(hex);
      const [a, b] = [relativeLuminance(background), relativeLuminance(text)].sort((x, y) => y - x);
      const ratio = ((a ?? 0) + 0.05) / ((b ?? 0) + 0.05);
      expect(ratio, hex).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("los claros llevan texto oscuro y los oscuros, blanco", () => {
    expect(readableTextColor("#f2c94c")).toBe("#111827");
    expect(readableTextColor("#374151")).toBe("#ffffff");
    expect(readableTextColor("nada")).toBe("#ffffff");
  });
});

describe("inkOnWhite", () => {
  it("cualquier color se lee sobre blanco a 4,5:1 o más", () => {
    for (const { hex } of [...COLOR_PALETTE, { hex: "#ffff00" }, { hex: "#2f80ed" }]) {
      const ink = inkOnWhite(hex);
      expect((1 + 0.05) / (relativeLuminance(ink) + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
    expect(inkOnWhite("#374151")).toBe("#374151");
  });
});
