// @vitest-environment node
import { describe, expect, it } from "vitest";
import { translateWith } from "./server-messages";
import en from "./server-messages.en";

/**
 * F8-06: la app de Android traduce los mensajes del servidor con estas mismas tablas, exportadas
 * a `apps/android/app/src/main/assets/server-messages.en.json`. Cada patrón se guarda como su
 * expresión regular y una plantilla (`{1}`, `{2}`…); `parts` dice qué grupos se traducen con la
 * tabla exacta (las piezas de los mensajes de las copias de seguridad).
 *
 * Si cambia algún mensaje, esta prueba falla hasta regenerar el fichero:
 * `pnpm --filter @delyra/ui exec vitest run server-messages.android -u`.
 */

const ANDROID_FILE = "../../../../apps/android/app/src/main/assets/server-messages.en.json";
/** Marca de un grupo en la plantilla (caracteres de uso privado: nunca salen en un mensaje). */
const token = (group: number) => `${String(group)}`;
/** Una pieza conocida: si el grupo pasa por la tabla exacta, sale traducida. */
const PART_PROBE = "calendarios";

function groupCount(pattern: RegExp): number {
  // Con una alternativa vacía la expresión casa con "" y devuelve todos sus grupos.
  return (new RegExp(`${pattern.source}|`).exec("")?.length ?? 1) - 1;
}

function androidServerMessages() {
  const patterns = en.patterns.map(([pattern, render]) => {
    const groups = Array.from({ length: groupCount(pattern) }, (_, i) => token(i + 1));
    const rendered = render(...groups);
    if (/[{}]/.test(rendered)) throw new Error(`Llaves en la plantilla de ${pattern.source}`);
    const parts = groups.flatMap((_, i) => {
      const probe = groups.map((group, j) => (j === i ? PART_PROBE : group));
      return render(...probe) === rendered.replace(token(i + 1), PART_PROBE) ? [] : [i + 1];
    });
    return {
      pattern: pattern.source,
      flags: pattern.flags,
      template: rendered.replace(/(\d+)/g, "{$1}"),
      parts,
    };
  });
  return { exact: en.exact, patterns };
}

describe("mensajes del servidor para Android", () => {
  const table = androidServerMessages();

  it("el fichero de la app está al día", async () => {
    await expect(`${JSON.stringify(table, null, 2)}\n`).toMatchFileSnapshot(ANDROID_FILE);
  });

  it("solo usa marcas que la app entiende", () => {
    for (const { flags } of table.patterns) expect(flags).toMatch(/^[is]*$/);
  });

  it("la plantilla da lo mismo que la función", () => {
    for (const [index, [pattern, render]] of en.patterns.entries()) {
      const { template, parts } = table.patterns[index]!;
      const groups = Array.from({ length: groupCount(pattern) }, (_, i) => `x${String(i)}`);
      const expected = template.replace(/\{(\d+)\}/g, (_, n: string) => groups[Number(n) - 1]!);
      if (parts.length === 0) expect(render(...groups)).toBe(expected);
    }
    expect(translateWith(en, "La copia tiene calendarios con el mismo id")).toBe(
      "The backup has calendars with the same id",
    );
    const sameId = table.patterns.find((p) => p.pattern.includes("con el mismo id"));
    expect(sameId?.parts).toEqual([1]);
  });
});
