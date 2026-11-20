import { type ComponentProps, type ReactNode, useId } from "react";
import { cn } from "../lib/utils";
import { Input } from "./input";

export interface FieldProps extends Omit<ComponentProps<"input">, "id"> {
  label: string;
  error?: string;
  hint?: ReactNode;
}

/** Campo de formulario accesible: etiqueta, ayuda y error enlazados al input. */
export function Field({ label, error, hint, className, ...props }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={cn("grid gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        {...props}
      />
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Mensaje de error de formulario (anunciado por lectores de pantalla). */
export function FormError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      {children}
    </p>
  );
}
