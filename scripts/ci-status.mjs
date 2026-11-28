#!/usr/bin/env node
// Cómo van el CI y el despliegue de un commit, desde la terminal y sin `gh` (API pública de
// GitHub). Cada push a main se despliega solo si su CI termina en verde (deploy.yml).
//
// Uso: pnpm ci:status [commit] [--wait]
//   commit   SHA o referencia de git (por defecto, HEAD).
//   --wait   espera a que terminen el CI y, si va en verde, el despliegue (hasta 45 min).
// Con GH_TOKEN o GITHUB_TOKEN en el entorno usa la API autenticada (más consultas por hora).
// Sale con 0 si todo va en verde (o si lo despliega un commit más nuevo de main), 1 si algo
// falla y 2 si se acaba la espera.

import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const wait = args.includes("--wait");
const ref = args.find((a) => !a.startsWith("--")) ?? "HEAD";
const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();

const sha = git("rev-parse", ref);
const remote = git("remote", "get-url", "origin");
const repo = /github\.com[/:]([^/]+\/[^/.]+)/.exec(remote)?.[1];
if (!repo) throw new Error(`El remoto origin no es de GitHub: ${remote}`);

const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
async function api(path) {
  const res = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "delyra-ci-status",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub respondió ${String(res.status)} a ${path}`);
  return res.json();
}

/**
 * El último CI de este commit y su despliegue. Uno lanzado a mano lleva su commit. Uno automático
 * lleva el SHA que tenía main al lanzarse, así que solo cuenta si se creó después de terminar
 * este CI (uno anterior con el mismo SHA era de otro commit y se saltó).
 */
async function snapshot() {
  const { workflow_runs: runs } = await api(`actions/runs?head_sha=${sha}&per_page=30`);
  const ci = runs.find((r) => r.name === "CI") ?? null;
  const ciDone = ci?.status === "completed" ? Date.parse(ci.updated_at) - 5_000 : null;
  const deploy =
    ciDone === null
      ? null
      : (runs.find(
          (r) =>
            r.name === "Deploy" &&
            (r.event === "workflow_dispatch" || Date.parse(r.created_at) >= ciDone),
        ) ?? null);
  let production = null;
  if (deploy?.status === "completed") {
    const { jobs } = await api(`actions/runs/${String(deploy.id)}/jobs`);
    production = jobs.find((j) => j.name === "Producción")?.conclusion ?? "skipped";
  }
  // Sin Deploy tras un CI en verde: o está en cola, o main ya va por otro commit.
  let newer = null;
  if (ci?.conclusion === "success" && !deploy && Date.now() - ciDone > 3 * 60_000) {
    const head = (await api("commits/main")).sha;
    if (head !== sha) newer = head;
  }
  return { ci, deploy, production, newer };
}

const line = (label, run, extra = "") =>
  run
    ? `${label.padEnd(7)} #${String(run.run_number).padEnd(4)} ${run.status.padEnd(11)} ${(run.conclusion ?? "-").padEnd(10)} ${run.html_url}${extra}`
    : `${label.padEnd(7)} todavía no hay ejecución`;

function report({ ci, deploy, production, newer }) {
  console.log(`Commit ${sha.slice(0, 7)} en ${repo}`);
  console.log(line("CI", ci));
  if (newer) {
    console.log(
      `Deploy  lo hace el commit más nuevo de main (${newer.slice(0, 7)}), que incluye este`,
    );
    return;
  }
  const where =
    production === "skipped"
      ? "  (saltado: main ya va por otro commit)"
      : production
        ? `  (producción: ${production})`
        : "";
  console.log(line("Deploy", deploy, where));
}

/** null mientras falte algo por terminar; si no, el código de salida. */
function outcome({ ci, deploy, production, newer }) {
  if (!ci || ci.status !== "completed") return null;
  if (ci.conclusion !== "success") return 1;
  if (newer) return 0;
  if (!deploy || deploy.status !== "completed") return null;
  return production === "success" || production === "skipped" ? 0 : 1;
}

const started = Date.now();
const pause = token ? 20_000 : 60_000; // sin token, la API pública da 60 consultas por hora
for (;;) {
  const state = await snapshot();
  const code = outcome(state);
  if (!wait || code !== null) {
    report(state);
    process.exit(code ?? 0);
  }
  if (Date.now() - started > 45 * 60_000) {
    report(state);
    console.log("Se acabó la espera (45 min).");
    process.exit(2);
  }
  console.log(
    `${new Date().toLocaleTimeString()} · CI: ${state.ci?.status ?? "sin empezar"} · Deploy: ${state.deploy?.status ?? "sin empezar"}`,
  );
  await new Promise((resolve) => setTimeout(resolve, pause));
}
