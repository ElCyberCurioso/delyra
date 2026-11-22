#!/usr/bin/env node
// Presupuesto de rendimiento (F7-07): lo que descarga cada SPA antes de pintar (JS y CSS que
// enlaza su index.html, comprimido con gzip) no puede pasar de su límite. Se ejecuta en CI tras
// `pnpm build`; si falla, o se reduce el bundle inicial (división por rutas) o se sube el límite
// a conciencia en este fichero.
//
// Uso: node scripts/check-bundle-size.mjs

import { readFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const ROOT = path.join(import.meta.dirname, "..");
/** KB gzip del JS + CSS inicial. */
const BUDGETS = { calendar: 230, work: 210 };

let failed = false;
for (const [app, budget] of Object.entries(BUDGETS)) {
  const dir = path.join(ROOT, "apps", app, "dist", "client");
  const html = readFileSync(path.join(dir, "index.html"), "utf8");
  const files = [
    ...new Set(
      [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]),
    ),
  ];
  let total = 0;
  for (const file of files) {
    total += gzipSync(readFileSync(path.join(dir, file)), { level: 9 }).byteLength;
  }
  const kb = Math.round(total / 1024);
  const ok = kb <= budget;
  failed ||= !ok;
  console.log(
    `${ok ? "✓" : "✗"} ${app}: ${String(kb)} KB gzip iniciales (límite ${String(budget)} KB, ${String(files.length)} ficheros)`,
  );
}
if (failed) {
  console.error("\nEl bundle inicial supera el presupuesto de rendimiento (F7-07).");
  process.exit(1);
}
