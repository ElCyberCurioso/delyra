#!/usr/bin/env node
// Comprobación previa al despliegue (F0-10): falla pronto y con un mensaje claro si faltan
// secretos de GitHub, si apps/api/wrangler.jsonc aún tiene identificadores de relleno o si los
// orígenes de staging (workers.dev, ADR-0003) no coinciden con la cuenta.
// Nunca imprime el valor de un secreto.
//
// En GitHub Actions escribe en $GITHUB_OUTPUT `calendar_url` y `work_url` del entorno.
//
// Uso: node scripts/check-deploy-config.mjs staging|production

import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.join(import.meta.dirname, "..");
const PLACEHOLDER_DB_ID = "00000000-0000-4000-8000-000000000000";
const PLACEHOLDER_SUBDOMAIN = "tu-subdominio";
const RUNBOOK_RESOURCES = "docs/runbooks/recursos-cloudflare.md";
const RUNBOOK_ACCESS = "docs/runbooks/dominios-y-acceso.md";
const ORIGINS_FILE = "packages/shared/src/app-origins.json";

const environment = process.argv[2];
if (environment !== "staging" && environment !== "production") {
  console.error("Uso: node scripts/check-deploy-config.mjs staging|production");
  process.exit(2);
}

/** @type {{ title: string; detail: string }[]} */
const problems = [];
/** @type {{ title: string; detail: string }[]} */
const warnings = [];

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
const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim() ?? "";

// ── Secretos de GitHub ──────────────────────────────────────────────────────────
const requiredSecrets = {
  CLOUDFLARE_API_TOKEN: "token de API de Cloudflare para CI (P-05)",
  CLOUDFLARE_ACCOUNT_ID: "Account ID de Cloudflare (P-05)",
};
if (environment === "staging") {
  requiredSecrets.CF_ACCESS_CLIENT_ID =
    "token de servicio de Cloudflare Access para los e2e (P-09)";
  requiredSecrets.CF_ACCESS_CLIENT_SECRET =
    "token de servicio de Cloudflare Access para los e2e (P-09)";
}
for (const [name, description] of Object.entries(requiredSecrets)) {
  if (!process.env[name]?.trim()) {
    problems.push({
      title: `Falta el secreto ${name}`,
      detail: `${description}. Créalo en Settings → Secrets and variables → Actions → Secrets (en el repositorio o en el Environment «${environment}»), no como Variable.`,
    });
  }
}

// ── Identificadores en apps/api/wrangler.jsonc ──────────────────────────────────
{
  const envConfig = readJsonc("apps/api/wrangler.jsonc").env?.[environment] ?? {};
  const databaseId = envConfig.d1_databases?.[0]?.database_id ?? "";
  const vars = envConfig.vars ?? {};

  if (!databaseId || databaseId === PLACEHOLDER_DB_ID) {
    problems.push({
      title: `D1 de ${environment} sin crear o sin conectar`,
      detail: `env.${environment}.d1_databases[0].database_id es el valor de relleno. Ejecuta scripts/provision-cloudflare.sh ${environment} y copia el UUID (${RUNBOOK_RESOURCES}).`,
    });
  }
  if (!vars.D1_DATABASE_ID) {
    problems.push({
      title: `Falta vars.D1_DATABASE_ID en env.${environment}`,
      detail: `Debe ser el mismo UUID que database_id; lo usa el backup diario (${RUNBOOK_RESOURCES}).`,
    });
  } else if (databaseId && vars.D1_DATABASE_ID !== databaseId) {
    problems.push({
      title: `vars.D1_DATABASE_ID no coincide con database_id en env.${environment}`,
      detail: "El backup exportaría otra base de datos. Usa el mismo UUID en los dos campos.",
    });
  }
  if (!vars.CF_ACCOUNT_ID) {
    problems.push({
      title: `Falta vars.CF_ACCOUNT_ID en env.${environment}`,
      detail: `Account ID de Cloudflare; lo usa el backup diario (${RUNBOOK_RESOURCES}).`,
    });
  } else if (accountId && vars.CF_ACCOUNT_ID !== accountId) {
    problems.push({
      title: `vars.CF_ACCOUNT_ID de env.${environment} no coincide con el secreto CLOUDFLARE_ACCOUNT_ID`,
      detail: "Los Workers y el backup estarían apuntando a cuentas distintas.",
    });
  }
}

// ── Orígenes de las SPA ─────────────────────────────────────────────────────────
const origins = readJsonc(ORIGINS_FILE)[environment] ?? {};

if (environment === "staging") {
  /** Subdominio workers.dev configurado, deducido de cada origen. */
  const configured = new Set();
  for (const app of ["calendar", "work"]) {
    const workerName = readJsonc(`apps/${app}/wrangler.jsonc`).env?.staging?.name;
    const workersDev = readJsonc(`apps/${app}/wrangler.jsonc`).env?.staging?.workers_dev;
    const match = new RegExp(`^https://${workerName}\\.([a-z0-9-]+)\\.workers\\.dev$`).exec(
      origins[app] ?? "",
    );
    if (!match) {
      problems.push({
        title: `Origen de staging de «${app}» con formato inesperado`,
        detail: `${ORIGINS_FILE} debe tener https://${workerName}.<subdominio>.workers.dev.`,
      });
    } else {
      configured.add(match[1]);
    }
    if (workersDev !== true) {
      problems.push({
        title: `apps/${app}/wrangler.jsonc: falta workers_dev: true en env.staging`,
        detail: "Staging se sirve en workers.dev (ADR-0003).",
      });
    }
  }

  // Subdominio real de la cuenta (no es secreto). Si la API no responde, solo se avisa.
  let actual = "";
  if (apiToken && accountId) {
    try {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/workers/subdomain`,
        { headers: { Authorization: `Bearer ${apiToken}` }, signal: AbortSignal.timeout(10_000) },
      );
      const body = await response.json().catch(() => ({}));
      if (response.ok && typeof body?.result?.subdomain === "string")
        actual = body.result.subdomain;
      else throw new Error(`HTTP ${String(response.status)}`);
    } catch (error) {
      warnings.push({
        title: "No se pudo leer el subdominio workers.dev de la cuenta",
        detail: `${String(error instanceof Error ? error.message : error)}. Se usa el de ${ORIGINS_FILE} sin comprobarlo.`,
      });
    }
  }

  const hint = actual ? ` El subdominio de tu cuenta es «${actual}».` : "";
  if (configured.has(PLACEHOLDER_SUBDOMAIN)) {
    problems.push({
      title: "Falta el subdominio workers.dev de staging",
      detail: `Sustituye «${PLACEHOLDER_SUBDOMAIN}» en ${ORIGINS_FILE}.${hint} Lo ves en Workers & Pages → «Your subdomain» (${RUNBOOK_ACCESS}).`,
    });
  } else if (configured.size > 1) {
    problems.push({
      title: "Los dos orígenes de staging usan subdominios distintos",
      detail: `Revisa ${ORIGINS_FILE}.${hint}`,
    });
  } else if (actual && !configured.has(actual)) {
    problems.push({
      title: "El subdominio workers.dev de staging no coincide con el de la cuenta",
      detail: `Corrige ${ORIGINS_FILE}.${hint}`,
    });
  }
}

// ── Resultado ───────────────────────────────────────────────────────────────────
const inActions = process.env.GITHUB_ACTIONS === "true";
const escape = (text) =>
  text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");

for (const { title, detail } of warnings) {
  if (inActions) console.log(`::warning title=${escape(title)}::${escape(detail)}`);
  else console.warn(`! ${title}\n  ${detail}`);
}

if (problems.length === 0) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `calendar_url=${origins.calendar}\nwork_url=${origins.work}\n`,
    );
  }
  console.log(`Configuración de despliegue de ${environment}: correcta.`);
  console.log(`  calendar: ${origins.calendar}\n  work:     ${origins.work}`);
  process.exit(0);
}

for (const { title, detail } of problems) {
  if (inActions) console.log(`::error title=${escape(title)}::${escape(detail)}`);
  else console.error(`✘ ${title}\n  ${detail}`);
}

if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    `## Despliegue de ${environment} bloqueado`,
    "",
    "Faltan requisitos antes de poder desplegar:",
    "",
    ...problems.map(({ title, detail }) => `- **${title}.** ${detail}`),
    "",
  ];
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
}

console.error(`\n${String(problems.length)} problema(s): despliegue de ${environment} cancelado.`);
process.exit(1);
