#!/usr/bin/env node
// Reordena un volcado de D1 (`wrangler d1 export` o el backup diario del sistema) para poder
// cargarlo en una base VACÍA (F6-07). El volcado crea e inserta tabla por tabla, así que inserta
// en tablas hijas (p. ej. `sessions`) antes de que exista su tabla padre (`users`), y D1 rechaza
// eso aunque se aplacen las claves foráneas («no such table: main.users»).
//
// Orden de salida: PRAGMA → todas las CREATE TABLE → todos los INSERT (en su orden original) →
// el resto (índices, triggers…). Las sentencias se separan respetando las cadenas SQL.
//
// Uso: node scripts/reorder-d1-dump.mjs <entrada.sql> <salida.sql>

import { readFileSync, writeFileSync } from "node:fs";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("Uso: node scripts/reorder-d1-dump.mjs <entrada.sql> <salida.sql>");
  process.exit(1);
}

/** Separa sentencias por `;` fuera de cadenas ('…') e identificadores ("…", `…`, […]). */
export function splitStatements(sql) {
  const statements = [];
  let start = 0;
  let quote = null;
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    if (quote) {
      if (char === quote) {
        // '' dentro de una cadena es una comilla escapada.
        if (sql[i + 1] === quote) i++;
        else quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") quote = char;
    else if (char === "[") quote = "]";
    else if (char === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? sql.length : end;
    } else if (char === ";") {
      const statement = sql.slice(start, i).trim();
      if (statement) statements.push(statement);
      start = i + 1;
    }
  }
  const rest = sql.slice(start).trim();
  if (rest) statements.push(rest);
  return statements;
}

const statements = splitStatements(readFileSync(input, "utf8"));
const kind = (s) => s.replace(/^\s+/, "").slice(0, 40).toUpperCase();
const pragmas = statements.filter((s) => kind(s).startsWith("PRAGMA"));
const tables = statements.filter((s) => kind(s).startsWith("CREATE TABLE"));
const inserts = statements.filter((s) => kind(s).startsWith("INSERT"));
const others = statements.filter(
  (s) => !pragmas.includes(s) && !tables.includes(s) && !inserts.includes(s),
);
const ordered = [...pragmas, ...tables, ...inserts, ...others];
writeFileSync(output, `${ordered.join(";\n")};\n`);
console.log(
  `${String(tables.length)} tablas, ${String(inserts.length)} inserciones, ${String(others.length)} otras sentencias → ${output}`,
);
