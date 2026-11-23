import { type ComponentProps, type ReactNode, useId } from "react";
import { translateServer } from "../i18n";
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
          {translateServer(error)}
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
      {typeof children === "string" ? translateServer(children) : children}
    </p>
  );
}

export interface SelectFieldProps extends Omit<ComponentProps<"select">, "id"> {
  label: string;
  options: readonly { value: string; label: string }[];
  error?: string;
  hint?: ReactNode;
}

/** Selector nativo con etiqueta: accesible y cómodo en móvil sin librerías extra. */
export function SelectField({
  label,
  options,
  error,
  hint,
  className,
  ...props
}: SelectFieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={cn("grid gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        className={cn(
          "h-9 w-full rounded-md border border-input bg-background px-3 text-base shadow-xs outline-none md:text-sm",
          "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
          "aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-50",
        )}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm text-destructive">
          {translateServer(error)}
        </p>
      ) : null}
    </div>
  );
}
