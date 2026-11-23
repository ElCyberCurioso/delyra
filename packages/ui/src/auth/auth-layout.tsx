import { SUPPORTED_LOCALES } from "@delyra/shared";
import { LanguagesIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Toaster } from "../components/toaster";
import { getLocale, LOCALE_NAMES, setLocale, ui } from "../i18n";
import { Brand } from "../layout/brand";

/** Cambio de idioma sin sesión (F7-06): se recuerda en este navegador. */
export function LanguageSwitch({ className = "mt-6" }: { className?: string }) {
  const others = SUPPORTED_LOCALES.filter((locale) => locale !== getLocale());
  return (
    <nav
      aria-label={ui().language.switchTo}
      className={`${className} flex items-center gap-2 text-sm`}
    >
      <LanguagesIcon aria-hidden="true" className="size-4 text-muted-foreground" />
      {others.map((locale) => (
        <button
          key={locale}
          type="button"
          lang={locale}
          onClick={() => void setLocale(locale)}
          className="min-h-6 rounded underline underline-offset-4 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {LOCALE_NAMES[locale]}
        </button>
      ))}
    </nav>
  );
}

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
      <LanguageSwitch />
      <Toaster />
    </div>
  );
}
