// @vitest-environment node
/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { translateWith } from "./server-messages";
import en from "./server-messages.en";

/**
 * F7-06: cada mensaje en español que el servidor o los esquemas compartidos pueden enseñar al
 * usuario tiene su traducción. Si se añade uno nuevo, esta prueba falla hasta traducirlo (o hasta
 * declararlo interno abajo).
 */

// Vitest se ejecuta desde packages/ui.
const ROOT = resolve(process.cwd(), "../..") + "/";
const SOURCES = ["apps/api/src", "packages/shared/src"];

/** Textos de servicio o de datos que nunca llegan como mensaje (o que se tratan aparte). */
const INTERNAL = new Set([
  "Clave de cifrado 7 no disponible",
  "Clave de cifrado actual no disponible",
  "La clave de cifrado debe tener 32 bytes",
  "Valor cifrado con formato no válido",
  "Falta el secreto FIELD_ENCRYPTION_KEY_V1",
  "Falta el secreto LOG_PSEUDONYM_KEY",
  "Falta la clave de seudonimización",
  "Código HTTP de error no válido: 7",
  "Sin usuario",
  "avisar a los administradores",
  "iniciar exportación de D1",
  "leer importación",
  "listar calendarios de Google",
  "preparar importación",
  "terminar importación",
  "private, no-store",
  "no-store",
  "no-referrer",
  "sin-uid-7",
  // Nombres de columnas y etiquetas de las plantillas: se crean en el idioma de la petición.
  "Crítica",
  "Deuda técnica",
  "En análisis",
  "En revisión",
]);

/** Ficheros con textos que se generan ya en el idioma de la cuenta o que son datos. */
const SKIP_FILES = new Set([
  "email-templates.ts",
  "notification-text.ts",
  "telegram-bot.ts",
  "bot-text.ts",
  "security-notify.ts",
  "notifications.ts",
  "admin-notify.ts",
  "ics.ts",
  "exports.ts",
  "quick-add.ts",
  "holidays.ts",
  "board-templates.ts",
  "mailer.ts",
]);

const SPANISH =
  /[áéíóúñ¿¡]|\b(?:el|la|los|las|de|del|un|una|no|que|para|con|sin|ya|se|tu|tus|es|hay|puede|debe|esta|este)\b/i;
const LITERAL = /"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
const LOGGING = /logger\??\.(?:info|warn|error|debug)\(|event:\s|audit\(/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return name.endsWith(".ts") && !name.includes(".test.") && !SKIP_FILES.has(name) ? [path] : [];
  });
}

/** Mensajes en español del código, con `${…}` sustituido por un valor de ejemplo. */
function serverMessages(): Map<string, string> {
  const found = new Map<string, string>();
  for (const source of SOURCES) {
    for (const file of files(join(ROOT, source))) {
      const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const [index, rawLine] of text.split("\n").entries()) {
        const line = rawLine.replace(/(^|[^:])\/\/.*$/, "$1");
        if (LOGGING.test(line)) continue;
        for (const match of line.matchAll(LITERAL)) {
          const value = (match[1] ?? match[2] ?? "").replace(/\$\{[^}]*\}/g, "7");
          if (value.length < 6 || !SPANISH.test(value) || /^(?:\/api|https?:)/.test(value))
            continue;
          // Plantillas anidadas a medio leer (« (…)»): se comprueban por su forma completa.
          if (value.includes("${") || value.startsWith(" (") || value.endsWith("${issue ? "))
            continue;
          if (!INTERNAL.has(value))
            found.set(value, `${file.slice(ROOT.length - 1)}:${String(index + 1)}`);
        }
      }
    }
  }
  return found;
}

describe("mensajes del servidor en inglés (F7-06)", () => {
  it("todos los mensajes en español tienen traducción", () => {
    const missing = [...serverMessages()]
      .filter(([message]) => translateWith(en, message) === message)
      .map(([message, where]) => `${where}  ${message}`);
    expect(missing).toEqual([]);
  });

  it("los mensajes con datos se traducen conservando los datos", () => {
    expect(translateWith(en, "Máximo 80 caracteres")).toBe("At most 80 characters");
    expect(translateWith(en, "La copia tiene referencias rotas (evento sin su calendario)")).toBe(
      "The backup has broken references (event without its calendar)",
    );
    expect(translateWith(en, "«foto.png» es demasiado grande")).toBe("“foto.png” is too large");
  });
});
