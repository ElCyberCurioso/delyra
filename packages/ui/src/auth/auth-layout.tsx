import type { ReactNode } from "react";
import { Toaster } from "../components/toaster";
import { Brand } from "../layout/brand";

/** Tarjeta centrada para login, registro, 2FA y recuperación. */
export function AuthLayout({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-10 text-foreground">
      <div className="mb-6">
        <Brand href="/" />
      </div>
      <main
        id="contenido"
        className="w-full max-w-sm rounded-xl border bg-card p-6 text-card-foreground shadow-sm"
      >
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        <div className="mt-6">{children}</div>
      </main>
      {footer ? <div className="mt-4 text-sm text-muted-foreground">{footer}</div> : null}
      <Toaster />
    </div>
  );
}
