import { ApiError } from "@delyra/ui";
import { useLocation } from "@tanstack/react-router";
import { useState } from "react";

interface Issue {
  path: PropertyKey[];
  message: string;
}

type SafeParse<T> =
  { success: true; data: T } | { success: false; error: { issues: readonly Issue[] } };

export type FieldErrors = Partial<Record<string, string>>;

/** Valida con un esquema compartido y devuelve el primer error de cada campo. */
export function validate<T>(
  schema: { safeParse: (data: unknown) => SafeParse<T> },
  data: unknown,
): { data: T; errors: null } | { data: null; errors: FieldErrors } {
  const result = schema.safeParse(data);
  if (result.success) return { data: result.data, errors: null };
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const key = issue.path.map(String).join(".");
    errors[key] ??= issue.message;
  }
  return { data: null, errors };
}

/** Campos de texto de un formulario como objeto plano. */
export function formValues(form: HTMLFormElement): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of new FormData(form)) {
    if (typeof value === "string") values[key] = value;
  }
  return values;
}

/** Errores por campo que devolvió la API (422) junto al mensaje general. */
export function apiFieldErrors(error: unknown): FieldErrors {
  if (!(error instanceof ApiError)) return {};
  const errors: FieldErrors = {};
  for (const item of error.problem?.errors ?? []) errors[item.path] ??= item.message;
  return errors;
}

/**
 * Lee el token del fragmento (`#token=…`) una sola vez y lo borra de la barra de direcciones:
 * el fragmento no viaja al servidor ni en el Referer, y así tampoco queda en el historial.
 */
export function useFragmentToken(): string | null {
  const [token] = useState(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get("token");
    if (value) {
      const url = new URL(window.location.href);
      url.hash = "";
      window.history.replaceState(window.history.state, "", url.href);
    }
    return value;
  });
  return token;
}

/**
 * `?next=` con el que se abrió la página (sin validar: eso lo hace `resolveNext` al usarlo).
 * Se lee una sola vez: al navegar al destino, la página aún se repinta con la URL nueva (sin
 * `next`) y, si se leyera de nuevo, sus efectos redirigirían a `/`.
 */
export function useNextParam(): string | undefined {
  const { searchStr } = useLocation();
  const [next] = useState(() => new URLSearchParams(searchStr).get("next") ?? undefined);
  return next;
}
