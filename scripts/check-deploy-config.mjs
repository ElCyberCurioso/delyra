#!/usr/bin/env node
// Comprobación previa al despliegue en producción (F0-10): falla pronto y con un mensaje claro si
// faltan secretos de GitHub, si apps/api/wrangler.jsonc aún tiene identificadores de relleno, si
// los dominios de las SPA no coinciden con packages/shared/src/app-origins.json o si al Worker del
// api le faltan secretos (solo consulta sus nombres en la API de Cloudflare).
// Nunca imprime el valor de un secreto.
//
// En GitHub Actions escribe en $GITHUB_OUTPUT `calendar_url` y `work_url`.
//
// Uso: node scripts/check-deploy-config.mjs

import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.join(import.meta.dirname, "..");
const ENVIRONMENT = "production";
const PLACEHOLDER_DB_ID = "00000000-0000-4000-8000-000000000000";
const RUNBOOK_RESOURCES = "docs/runbooks/recursos-cloudflare.md";
const RUNBOOK_ACCESS = "docs/runbooks/dominios-y-acceso.md";
const ORIGINS_FILE = "packages/shared/src/app-origins.json";

/** @type {{ title: string; detail: string }[]} */
const problems = [];

/** Lee un fichero JSON o JSONC (comentarios y comas finales) relativo a la raíz. */
function readJsonc(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  const parsed = ts.parseConfigFileTextToJson(fullPath, readFileSync(fullPath, "utf8"));
  if (parsed.error) {
    problems.push({ title: `${relativePath} no es válido`, detail: "Revisa la sintaxis." });
    return {};
  }
  return parsed.config ?? {};
}

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "";

// ── Secretos de GitHub ──────────────────────────────────────────────────────────
// Pares [nombre, para qué sirve]. Como lista y no como asignaciones `obj.X_SECRET = "…"`, que
// Semgrep (njsscan node_secret) confunde con secretos escritos en el código.
const requiredSecrets = [
  ["CLOUDFLARE_API_TOKEN", "token de API de Cloudflare para CI (P-05)"],
  ["CLOUDFLARE_ACCOUNT_ID", "Account ID de Cloudflare (P-05)"],
];
for (const [name, description] of requiredSecrets) {
  if (!process.env[name]?.trim()) {
    problems.push({
      title: `Falta el secreto ${name}`,
      detail: `${description}. Créalo en Settings → Secrets and variables → Actions → Secrets (en el repositorio o en el Environment «${ENVIRONMENT}»), no como Variable.`,
    });
  }
}

let telegramEnabled = false;

// ── Identificadores en apps/api/wrangler.jsonc ──────────────────────────────────
{
  const envConfig = readJsonc("apps/api/wrangler.jsonc").env?.[ENVIRONMENT] ?? {};
  const databaseId = envConfig.d1_databases?.[0]?.database_id ?? "";
  const vars = envConfig.vars ?? {};

  if (!databaseId || databaseId === PLACEHOLDER_DB_ID) {
    problems.push({
      title: "D1 de producción sin crear o sin conectar",
      detail: `env.${ENVIRONMENT}.d1_databases[0].database_id es el valor de relleno. Ejecuta scripts/provision-cloudflare.sh y copia el UUID (${RUNBOOK_RESOURCES}).`,
    });
  }
  if (!vars.D1_DATABASE_ID) {
    problems.push({
      title: `Falta vars.D1_DATABASE_ID en env.${ENVIRONMENT}`,
      detail: `Debe ser el mismo UUID que database_id; lo usa el backup diario (${RUNBOOK_RESOURCES}).`,
    });
  } else if (databaseId && vars.D1_DATABASE_ID !== databaseId) {
    problems.push({
      title: `vars.D1_DATABASE_ID no coincide con database_id en env.${ENVIRONMENT}`,
      detail: "El backup exportaría otra base de datos. Usa el mismo UUID en los dos campos.",
    });
  }
  if (!vars.CF_ACCOUNT_ID) {
    problems.push({
      title: `Falta vars.CF_ACCOUNT_ID en env.${ENVIRONMENT}`,
      detail: `Account ID de Cloudflare; lo usa el backup diario (${RUNBOOK_RESOURCES}).`,
    });
  } else if (accountId && vars.CF_ACCOUNT_ID !== accountId) {
    problems.push({
      title: `vars.CF_ACCOUNT_ID de env.${ENVIRONMENT} no coincide con el secreto CLOUDFLARE_ACCOUNT_ID`,
      detail: "Los Workers y el backup estarían apuntando a cuentas distintas.",
    });
  }
  if (vars.TELEGRAM_BOT_USERNAME) telegramEnabled = true;
  if (!vars.TURNSTILE_SITE_KEY) {
    problems.push({
      title: `Falta vars.TURNSTILE_SITE_KEY en env.${ENVIRONMENT}`,
      detail: `Sin el widget de Turnstile nadie puede iniciar sesión ni registrarse (P-08, ${RUNBOOK_ACCESS}).`,
    });
  }
}

// ── Secretos del Worker del api ─────────────────────────────────────────────────
// Se consultan solo los nombres. Si la API no responde se avisa, pero no se bloquea.
const workerSecrets = [
  ["LOG_PSEUDONYM_KEY", "clave HMAC para seudonimizar IPs y emails en logs y contadores"],
  ["FIELD_ENCRYPTION_KEY_V1", "clave AES-256 que cifra las semillas TOTP en D1"],
  ["TURNSTILE_SECRET_KEY", "secreto del widget de Turnstile (P-08)"],
  ["D1_EXPORT_API_TOKEN", "token para el export diario de D1 (backup)"],
  // Con TELEGRAM_BOT_USERNAME puesto, el bot tiene que estar configurado (P-10).
  ...(telegramEnabled
    ? [
        ["TELEGRAM_BOT_TOKEN", "token del bot de @BotFather (pnpm telegram:setup)"],
        ["TELEGRAM_WEBHOOK_SECRET", "secreto del webhook de Telegram (pnpm telegram:setup)"],
      ]
    : []),
];
{
  const apiName = readJsonc("apps/api/wrangler.jsonc").env?.[ENVIRONMENT]?.name ?? "delyra-api";
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (token && accountId) {
    try {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${apiName}/secrets`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (response.status === 404) {
        console.warn(`Aviso: ${apiName} aún no existe; no se comprueban sus secretos.`);
      } else if (!response.ok) {
        console.warn(
          `Aviso: no se pudieron listar los secretos de ${apiName} (HTTP ${String(response.status)}).`,
        );
      } else {
        const body = await response.json();
        const present = new Set((body.result ?? []).map((secret) => secret.name));
        for (const [name, description] of workerSecrets) {
          if (!present.has(name)) {
            problems.push({
              title: `Falta el secreto ${name} en el Worker ${apiName}`,
              detail: `${description}. Cárgalo con \`pnpm --filter @delyra/api exec wrangler secret put ${name} --env ${ENVIRONMENT}\` (${RUNBOOK_ACCESS}).`,
            });
          }
        }
      }
    } catch {
      console.warn(
        `Aviso: no se pudo contactar con la API de Cloudflare para revisar los secretos.`,
      );
    }
  }
}

// ── Dominios de las SPA ─────────────────────────────────────────────────────────
const origins = readJsonc(ORIGINS_FILE)[ENVIRONMENT] ?? {};
for (const app of ["calendar", "work"]) {
  let host = "";
  try {
    host = new URL(origins[app] ?? "").host;
  } catch {
    problems.push({
      title: `Origen de «${app}» no válido en ${ORIGINS_FILE}`,
      detail: "Debe ser un origen https:// completo.",
    });
    continue;
  }
  const routes = readJsonc(`apps/${app}/wrangler.jsonc`).env?.[ENVIRONMENT]?.routes ?? [];
  const hasDomain = routes.some((route) => route?.pattern === host && route?.custom_domain);
  if (!hasDomain) {
    problems.push({
      title: `apps/${app}/wrangler.jsonc no publica ${host}`,
      detail: `env.${ENVIRONMENT}.routes debe tener { "pattern": "${host}", "custom_domain": true }, igual que ${ORIGINS_FILE}.`,
    });
  }
}

// ── Resultado ───────────────────────────────────────────────────────────────────
const inActions = process.env.GITHUB_ACTIONS === "true";
const escape = (text) =>
  text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");

if (problems.length === 0) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `calendar_url=${origins.calendar}\nwork_url=${origins.work}\n`,
    );
  }
  console.log("Configuración de despliegue de producción: correcta.");
  console.log(`  calendar: ${origins.calendar}\n  work:     ${origins.work}`);
  process.exit(0);
}

for (const { title, detail } of problems) {
  if (inActions) console.log(`::error title=${escape(title)}::${escape(detail)}`);
  else console.error(`✘ ${title}\n  ${detail}`);
}

if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    "## Despliegue de producción bloqueado",
    "",
    "Faltan requisitos antes de poder desplegar:",
    "",
    ...problems.map(({ title, detail }) => `- **${title}.** ${detail}`),
    "",
  ];
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
}

console.error(`\n${String(problems.length)} problema(s): despliegue de producción cancelado.`);
process.exit(1);
