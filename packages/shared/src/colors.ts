/**
 * Paleta de colores para calendarios, etiquetas y tarjetas. Además de estos se admite cualquier
 * color `#rrggbb` (el selector tiene «personalizado»); el texto encima se elige con
 * `readableTextColor` para que siempre se lea (WCAG 1.4.3).
 */
export const COLOR_PALETTE = [
  { key: "violet", hex: "#7c5cff" },
  { key: "indigo", hex: "#5b5bd6" },
  { key: "blue", hex: "#2f80ed" },
  { key: "sky", hex: "#0ea5e9" },
  { key: "teal", hex: "#00a3a3" },
  { key: "emerald", hex: "#10b981" },
  { key: "green", hex: "#27ae60" },
  { key: "lime", hex: "#84cc16" },
  { key: "yellow", hex: "#f2c94c" },
  { key: "amber", hex: "#f59e0b" },
  { key: "orange", hex: "#f2994a" },
  { key: "red", hex: "#eb5757" },
  { key: "crimson", hex: "#e11d48" },
  { key: "pink", hex: "#d6409f" },
  { key: "purple", hex: "#a855f7" },
  { key: "brown", hex: "#8d6e63" },
  { key: "slate", hex: "#64748b" },
  { key: "graphite", hex: "#374151" },
] as const;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Luminancia relativa (WCAG) de un color `#rrggbb`. */
export function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Blanco o casi negro, el que más contraste tenga con el fondo. */
export function readableTextColor(background: string): "#ffffff" | "#111827" {
  if (!HEX_COLOR.test(background)) return "#ffffff";
  const l = relativeLuminance(background);
  const onWhite = 1.05 / (l + 0.05);
  const onDark = (l + 0.05) / (relativeLuminance("#111827") + 0.05);
  return onWhite >= onDark ? "#ffffff" : "#111827";
}

const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

function darken(hex: string, amount: number): string {
  const channel = (i: number) =>
    Math.round(Number.parseInt(hex.slice(i, i + 2), 16) * (1 - amount))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

/**
 * El mismo color, oscurecido lo justo para leerse como texto sobre blanco (≥ 4,5:1): etiquetas
 * blancas con el nombre de un calendario encima de su color.
 */
export function inkOnWhite(color: string): string {
  if (!HEX_COLOR.test(color)) return "#374151";
  const base = color.toLowerCase();
  if (contrast(relativeLuminance(base), 1) >= 4.5) return base;
  for (let amount = 0.04; amount < 0.8; amount += 0.04) {
    const darker = darken(base, amount);
    if (contrast(relativeLuminance(darker), 1) >= 4.5) return darker;
  }
  return "#374151";
}

/**
 * Fondo y texto para pintar algo de un color con texto encima (eventos del calendario): si ni el
 * blanco ni el oscuro llegan a 4,5:1, el fondo se oscurece lo justo para que el blanco sí llegue.
 */
export function readableColors(color: string): { background: string; text: string } {
  if (!HEX_COLOR.test(color)) return { background: color, text: "#ffffff" };
  const background = color.toLowerCase();
  const text = readableTextColor(background);
  if (contrast(relativeLuminance(background), relativeLuminance(text)) >= 4.5) {
    return { background, text };
  }
  for (let amount = 0.04; amount < 0.6; amount += 0.04) {
    const darker = darken(background, amount);
    if (contrast(relativeLuminance(darker), 1) >= 4.5)
      return { background: darker, text: "#ffffff" };
  }
  return { background: "#374151", text: "#ffffff" };
}
