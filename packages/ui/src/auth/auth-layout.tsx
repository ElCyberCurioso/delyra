import { SUPPORTED_LOCALES } from "@delyra/shared";
import {
  BellRingIcon,
  CalendarDaysIcon,
  LanguagesIcon,
  ShieldCheckIcon,
  SquareKanbanIcon,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
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

const order = (i: number) => ({ "--i": i }) as CSSProperties;

/** Panel de marca (solo en pantallas anchas, decorativo): lo que ofrece Delyra en mosaicos. */
function BrandPanel() {
  const t = ui().authPanel;
  const week = ["L", "M", "X", "J", "V", "S", "D"];
  return (
    <div
      aria-hidden="true"
      className="brand-gradient relative hidden overflow-hidden p-10 text-white lg:flex lg:flex-col lg:justify-between"
    >
      <div className="pointer-events-none absolute -top-24 -right-24 size-96 rounded-full bg-white/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -left-16 size-96 rounded-full bg-black/15 blur-3xl" />
      <div className="relative max-w-md">
        <p
          className="animate-rise text-4xl leading-tight font-bold tracking-tight"
          style={order(0)}
        >
          {t.tagline}
        </p>
        <p className="animate-rise mt-3 text-white/85" style={order(1)}>
          {t.subtitle}
        </p>
      </div>
      <div className="relative grid grid-cols-6 gap-3">
        <div
          className="animate-rise col-span-4 row-span-2 rounded-3xl bg-white/15 p-5 ring-1 ring-white/25 backdrop-blur-md"
          style={order(2)}
        >
          <div className="flex items-center gap-2 font-semibold">
            <CalendarDaysIcon className="size-5" /> {t.calendar}
          </div>
          <p className="mt-1 text-sm text-white/80">{t.calendarDesc}</p>
          <div className="mt-4 grid grid-cols-7 gap-1.5 text-center text-xs">
            {week.map((d, i) => (
              <span key={d} className="rounded-lg bg-white/10 py-2">
                {d}
                <span
                  className={`mx-auto mt-1.5 block h-1.5 w-4 rounded-full ${i === 2 || i === 4 ? "bg-white" : "bg-white/25"}`}
                />
              </span>
            ))}
          </div>
        </div>
        <div
          className="animate-rise col-span-2 grid place-items-center rounded-3xl bg-white/15 p-4 text-center ring-1 ring-white/25 backdrop-blur-md"
          style={order(3)}
        >
          <ShieldCheckIcon className="size-7" />
          <span className="mt-1 text-sm font-semibold">{t.secure}</span>
        </div>
        <div
          className="animate-rise col-span-2 grid place-items-center rounded-3xl bg-white/15 p-4 text-center ring-1 ring-white/25 backdrop-blur-md"
          style={order(4)}
        >
          <BellRingIcon className="size-7" />
          <span className="mt-1 text-sm font-semibold">{t.alerts}</span>
        </div>
        <div
          className="animate-rise col-span-6 rounded-3xl bg-white/15 p-5 ring-1 ring-white/25 backdrop-blur-md"
          style={order(5)}
        >
          <div className="flex items-center gap-2 font-semibold">
            <SquareKanbanIcon className="size-5" /> {t.work}
          </div>
          <p className="mt-1 text-sm text-white/80">{t.workDesc}</p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {[3, 2, 1].map((n, column) => (
              <div key={column} className="grid content-start gap-1.5 rounded-xl bg-white/10 p-2">
                {Array.from({ length: n }, (_, i) => (
                  <span key={i} className="h-3 rounded-md bg-white/35" />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Acceso, registro, 2FA y recuperación: formulario en un mosaico y panel de marca al lado. */
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
    <div className="grid min-h-dvh text-foreground lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <BrandPanel />
      <div className="flex flex-col items-center justify-center px-4 py-10">
        <div className="animate-rise mb-6" style={order(0)}>
          <Brand href="/" />
        </div>
        <main id="contenido" className="tile animate-rise w-full max-w-sm p-7" style={order(1)}>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {description ? (
            <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
          ) : null}
          <div className="mt-6">{children}</div>
        </main>
        {footer ? (
          <div className="animate-rise mt-4 text-sm text-muted-foreground" style={order(2)}>
            {footer}
          </div>
        ) : null}
        <LanguageSwitch />
        <Toaster />
      </div>
    </div>
  );
}
