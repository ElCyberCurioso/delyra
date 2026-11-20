#!/usr/bin/env node
// Comprobación previa al despliegue en producción (F0-10): falla pronto y con un mensaje claro si
// faltan secretos de GitHub, si apps/api/wrangler.jsonc aún tiene identificadores de relleno o si
// los dominios de las SPA no coinciden con packages/shared/src/app-origins.json.
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
