import type { ReactNode } from "react";

/** Bloque de una página de ajustes o administración, con título enlazable. */
export function Section({
  id,
  title,
  description,
  children,
  actions,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-titulo`}
      className="tile animate-rise min-w-0 scroll-mt-24 p-5 sm:p-6"
    >
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={`${id}-titulo`} className="text-lg font-bold tracking-tight">
            {title}
          </h2>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
