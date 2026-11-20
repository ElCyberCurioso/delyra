#!/usr/bin/env node
// Comprobación previa al despliegue (F0-10): falla pronto y con un mensaje claro si faltan
// secretos de GitHub o si apps/api/wrangler.jsonc aún tiene identificadores de relleno.
// Nunca imprime el valor de un secreto.
//
// Uso: node scripts/check-deploy-config.mjs staging|production

import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const PLACEHOLDER_DB_ID = "00000000-0000-4000-8000-000000000000";
const RUNBOOK = "docs/runbooks/recursos-cloudflare.md";

const environment = process.argv[2];
if (environment !== "staging" && environment !== "production") {
  console.error("Uso: node scripts/check-deploy-config.mjs staging|production");
  process.exit(2);
}

/** @type {{ title: string; detail: string }[]} */
const problems = [];

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
const configPath = path.join(import.meta.dirname, "..", "apps", "api", "wrangler.jsonc");
const parsed = ts.parseConfigFileTextToJson(configPath, readFileSync(configPath, "utf8"));
if (parsed.error) {
  problems.push({ title: "apps/api/wrangler.jsonc no es válido", detail: "Revisa la sintaxis." });
} else {
  const envConfig = parsed.config?.env?.[environment] ?? {};
  const databaseId = envConfig.d1_databases?.[0]?.database_id ?? "";
  const vars = envConfig.vars ?? {};

  if (!databaseId || databaseId === PLACEHOLDER_DB_ID) {
    problems.push({
      title: `D1 de ${environment} sin crear o sin conectar`,
      detail: `env.${environment}.d1_databases[0].database_id es el valor de relleno. Ejecuta scripts/provision-cloudflare.sh ${environment} y copia el UUID (${RUNBOOK}).`,
    });
  }
  if (!vars.D1_DATABASE_ID) {
    problems.push({
      title: `Falta vars.D1_DATABASE_ID en env.${environment}`,
      detail: `Debe ser el mismo UUID que database_id; lo usa el backup diario (${RUNBOOK}).`,
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
      detail: `Account ID de Cloudflare; lo usa el backup diario (${RUNBOOK}).`,
    });
  } else if (
    process.env.CLOUDFLARE_ACCOUNT_ID?.trim() &&
    vars.CF_ACCOUNT_ID !== process.env.CLOUDFLARE_ACCOUNT_ID.trim()
  ) {
    problems.push({
      title: `vars.CF_ACCOUNT_ID de env.${environment} no coincide con el secreto CLOUDFLARE_ACCOUNT_ID`,
      detail: "Los Workers y el backup estarían apuntando a cuentas distintas.",
    });
  }
}

// ── Resultado ───────────────────────────────────────────────────────────────────
const inActions = process.env.GITHUB_ACTIONS === "true";
const escape = (text) =>
  text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");

if (problems.length === 0) {
  console.log(`Configuración de despliegue de ${environment}: correcta.`);
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
