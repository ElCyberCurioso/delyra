// Conventional Commits + identificador de tarea del plan (p. ej. [F1-08]).
// El identificador es un aviso (nivel 1) para no bloquear commits de mantenimiento
// (Renovate, chore) que no corresponden a ninguna tarea.
const TASK_ID = /\[(?:F\d+-\d{2}|P-\d{2})\]/;

/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ["@commitlint/config-conventional"],
  plugins: [
    {
      rules: {
        "task-id": ({ header }) => [
          TASK_ID.test(header ?? ""),
          "añade el identificador de la tarea al final del asunto, p. ej. [F0-03]",
        ],
      },
    },
  ],
  rules: {
    "task-id": [1, "always"],
    "header-max-length": [2, "always", 100],
    "subject-case": [0],
  },
};
