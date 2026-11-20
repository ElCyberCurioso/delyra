#!/usr/bin/env node
/**
 * Crea una invitación directamente en D1. Sirve para dar de alta al primer administrador
 * (después, las invitaciones se crean desde la propia aplicación).
 *
 *   node scripts/create-invitation.mjs --email tu@correo.com --role admin [--days 7] [--local]
 *
 * Sin `--local` escribe en la base de datos de PRODUCCIÓN (usa tu sesión de `wrangler login`
 * o CLOUDFLARE_API_TOKEN). Imprime el enlace de registro: el token va en el fragmento (#), no
 * se guarda en ningún sitio más que en D1 como hash SHA-256 y caduca a los días indicados.
 * Trátalo como una contraseña: no lo pegues en chats ni tickets.
 */
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { parseArgs } from "node:util";

const root = path.resolve(import.meta.dirname, "..");
const apiDir = path.join(root, "apps", "api");

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    role: { type: "string", default: "member" },
    days: { type: "string", default: "7" },
    local: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
});

if (values.help || !values.email) {
  console.log(
    "Uso: node scripts/create-invitation.mjs --email <email> [--role admin|member] [--days 1-30] [--local]",
  );
  process.exit(values.help ? 0 : 1);
}

// Validación estricta: los valores acaban en una sentencia SQL.
const email = values.email.trim().toLowerCase();
if (!/^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(email) || email.length > 254) {
  fail(`Email no válido: ${email}`);
}
const role = values.role;
if (role !== "admin" && role !== "member") fail("--role debe ser admin o member");
const days = Number(values.days);
if (!Number.isInteger(days) || days < 1 || days > 30)
  fail("--days debe ser un entero entre 1 y 30");

function uuidv7() {
  const bytes = randomBytes(16);
  const ms = BigInt(Date.now());
  for (let i = 0; i < 6; i++) bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const token = randomBytes(32).toString("base64url");
const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
const now = Date.now();
const expiresAt = now + days * 24 * 60 * 60 * 1000;
const id = uuidv7();

// Si ya hay una invitación pendiente para ese email, se revoca: solo vale el enlace nuevo.
const sql = [
  `UPDATE invitations SET revoked_at = ${String(now)} WHERE email = '${email}' AND accepted_at IS NULL AND revoked_at IS NULL;`,
  `INSERT INTO invitations (id, email, role, token_hash, created_by, created_at, expires_at) VALUES ('${id}', '${email}', '${role}', '${tokenHash}', NULL, ${String(now)}, ${String(expiresAt)});`,
].join(" ");

const wranglerPkg = createRequire(path.join(apiDir, "package.json")).resolve(
  "wrangler/package.json",
);
const wranglerBin = path.join(path.dirname(wranglerPkg), "bin", "wrangler.js");
const target = values.local
  ? ["--local", "--persist-to", path.join(root, ".wrangler", "state")]
  : ["--env", "production", "--remote"];

console.log(
  values.local
    ? "→ Base de datos local (.wrangler/state)"
    : "→ Base de datos de PRODUCCIÓN (delyra-prod)",
);
// Sin shell: los argumentos llegan tal cual a wrangler.
const result = spawnSync(
  process.execPath,
  [wranglerBin, "d1", "execute", "DB", ...target, "--command", sql],
  { cwd: apiDir, stdio: ["inherit", "pipe", "inherit"], encoding: "utf8" },
);
if (result.status !== 0) {
  process.stdout.write(result.stdout ?? "");
  fail("wrangler no pudo ejecutar la consulta (¿migraciones aplicadas? ¿sesión iniciada?)");
}

const origins = JSON.parse(
  readFileSync(path.join(root, "packages", "shared", "src", "app-origins.json"), "utf8"),
);
const calendar = values.local ? origins.development.calendar : origins.production.calendar;

console.log(`\n✔ Invitación creada para ${email} (${role}), caduca en ${String(days)} días.`);
console.log("\nAbre este enlace para registrarte (no lo compartas):\n");
console.log(`  ${calendar}/registro#token=${token}\n`);
