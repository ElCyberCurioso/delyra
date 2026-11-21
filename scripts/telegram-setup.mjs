#!/usr/bin/env node
/**
 * Configura el bot de Telegram de producción (F3-03, P-10). Ejecútalo en tu terminal:
 *
 *   pnpm telegram:setup
 *
 * 1. Pide el token de @BotFather sin mostrarlo (o lo lee de TELEGRAM_BOT_TOKEN).
 * 2. Comprueba el token (getMe) y genera un secreto aleatorio para el webhook.
 * 3. Carga TELEGRAM_BOT_TOKEN y TELEGRAM_WEBHOOK_SECRET como secretos del Worker delyra-api.
 * 4. Registra el webhook (con el secreto) y los comandos del bot.
 *
 * Nunca imprime el token ni el secreto. Después hay que poner el nombre del bot en
 * TELEGRAM_BOT_USERNAME (apps/api/wrangler.jsonc, env.production.vars) y desplegar.
 */
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";

const root = path.resolve(import.meta.dirname, "..");
const apiDir = path.join(root, "apps", "api");

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "https://delyra.app/api/telegram/webhook" },
    help: { type: "boolean", short: "h", default: false },
  },
});
if (values.help) {
  console.log("Uso: pnpm telegram:setup [--url https://delyra.app/api/telegram/webhook]");
  process.exit(0);
}

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

/** Lee una línea sin mostrarla en pantalla. */
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const write = rl._writeToOutput?.bind(rl);
    rl._writeToOutput = (text) => {
      if (text.includes(question)) write?.(text);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

async function telegram(token, method, params = {}) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await response.json().catch(() => ({}));
  if (!data.ok) fail(`Telegram rechazó ${method}: ${data.description ?? response.status}`);
  return data.result;
}

function putSecret(name, value) {
  const pkg = createRequire(path.join(apiDir, "package.json")).resolve("wrangler/package.json");
  const bin = path.join(path.dirname(pkg), "bin", "wrangler.js");
  const result = spawnSync(process.execPath, [bin, "secret", "put", name, "--env", "production"], {
    cwd: apiDir,
    input: value,
    stdio: ["pipe", "ignore", "inherit"],
    encoding: "utf8",
  });
  if (result.status !== 0) fail(`wrangler no pudo cargar ${name} (¿sesión iniciada?)`);
  console.log(`✔ Secreto ${name} cargado en delyra-api`);
}

const token = process.env.TELEGRAM_BOT_TOKEN?.trim() || (await askHidden("Token de @BotFather: "));
if (!/^\d+:[\w-]{30,}$/.test(token)) fail("Eso no parece un token de bot (123456:ABC…)");

const me = await telegram(token, "getMe");
console.log(`✔ Token válido: @${me.username}`);

const webhookSecret = randomBytes(32).toString("hex");
putSecret("TELEGRAM_BOT_TOKEN", token);
putSecret("TELEGRAM_WEBHOOK_SECRET", webhookSecret);

await telegram(token, "setWebhook", {
  url: values.url,
  secret_token: webhookSecret,
  allowed_updates: ["message", "callback_query"],
  drop_pending_updates: true,
});
console.log(`✔ Webhook: ${values.url}`);

await telegram(token, "setMyCommands", {
  language_code: "es",
  commands: [
    { command: "hoy", description: "Agenda de hoy" },
    { command: "manana", description: "Agenda de mañana" },
    { command: "semana", description: "Próximos 7 días" },
    { command: "nuevo", description: "Crear un evento: /nuevo Dentista mañana 17:30" },
    { command: "tareas", description: "Tareas pendientes" },
    {
      command: "silenciar",
      description: "Silenciar alertas: /silenciar 2 (horas) u /silenciar no",
    },
    { command: "desvincular", description: "Desvincular esta cuenta de Telegram" },
    { command: "ayuda", description: "Qué puedo hacer" },
  ],
});
console.log("✔ Comandos del bot registrados");

console.log(`
Último paso: en apps/api/wrangler.jsonc → env.production.vars pon
  "TELEGRAM_BOT_USERNAME": "${me.username}"
y despliega. Hasta entonces, el webhook responde 404 y Telegram reintentará.`);
