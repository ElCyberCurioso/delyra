import {
  CALENDAR_COLORS,
  type CalendarInfo,
  type ImportCalendarPreview,
  type ImportInfo,
  type StartImportRequest,
  type SubscriptionInfo,
} from "@delyra/shared";
import {
  AppShell,
  Button,
  errorMessage,
  Field,
  FormError,
  RequireSession,
  SelectField,
  toast,
  useLogout,
} from "@delyra/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useRouter } from "@tanstack/react-router";
import {
  CheckCircle2Icon,
  FileUpIcon,
  LinkIcon,
  Loader2Icon,
  LogInIcon,
  RefreshCwIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { CALENDARS_KEY, EVENTS_KEY, useCalendars, useInvalidateEvents } from "../calendar/api";
import { ColorPicker } from "../calendar/calendar-list";
import { Section } from "../settings/section";
import {
  authorizeGoogle,
  discardImport,
  IMPORTS_KEY,
  importKey,
  SUBSCRIPTIONS_KEY,
  startImport,
  subscribe,
  syncSubscription,
  unsubscribe,
  uploadImport,
  useGoogleStatus,
  useImport,
  useImports,
  useSubscriptions,
} from "./api";

/**
 * Asistente de importación desde Google Calendar (F5-03): exportación en `.zip`/`.ics`,
 * conexión con la cuenta (OAuth, F5-04) y suscripción a la dirección iCal secreta (F5-06).
 */

const GOOGLE_MESSAGES: Record<string, string> = {
  denied: "Has cancelado la conexión con Google. No se ha importado nada.",
  state:
    "La respuesta de Google no era válida o había caducado. Vuelve a pulsar «Conectar con Google».",
  busy: "Ya tienes una importación en marcha. Espera a que termine.",
  error: "No se ha podido conectar con Google. Vuelve a intentarlo.",
};

const dateFormat = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium" });
const dateTimeFormat = new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short" });

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString("es-ES")} ${n === 1 ? one : many}`;

function period(calendar: ImportCalendarPreview): string | null {
  if (!calendar.firstStart || !calendar.lastStart) return null;
  const first = dateFormat.format(new Date(calendar.firstStart));
  const last = dateFormat.format(new Date(calendar.lastStart));
  return first === last ? first : `${first} – ${last}`;
}

// ── Elegir origen ────────────────────────────────────────────────────────────

function FileImport({ onStarted }: { onStarted: (id: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) {
      setError("Elige el .zip o el .ics que has exportado.");
      return;
    }
    setError(null);
    setPending(true);
    try {
      onStarted((await uploadImport(file)).id);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <Section
      id="archivo"
      title="Desde un archivo exportado"
      description={
        <>
          En Google Calendar, abre <strong>Configuración → Importar y exportar → Exportar</strong>.
          Descargarás un .zip con un .ics por calendario. También vale un .ics suelto.
        </>
      }
    >
      <form noValidate onSubmit={(e) => void submit(e)} className="grid gap-3">
        <FormError>{error}</FormError>
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">Archivo (.zip o .ics, hasta 25 MB)</span>
          <input
            ref={input}
            type="file"
            accept=".zip,.ics,application/zip,text/calendar"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm file:font-medium file:text-secondary-foreground"
          />
        </label>
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? (
              <Loader2Icon aria-hidden="true" className="animate-spin" />
            ) : (
              <FileUpIcon aria-hidden="true" />
            )}
            Subir y ver qué contiene
          </Button>
        </div>
      </form>
    </Section>
  );
}

function GoogleConnect() {
  const status = useGoogleStatus();
  const [pending, setPending] = useState(false);
  const enabled = status.data?.enabled === true;
  return (
    <Section
      id="cuenta"
      title="Desde tu cuenta de Google"
      description="Delyra lee tus calendarios, colores, eventos y recordatorios una sola vez, con permiso de solo lectura. No guarda ningún acceso permanente a tu cuenta."
    >
      {status.isPending ? null : enabled ? (
        <Button
          disabled={pending}
          onClick={() => {
            setPending(true);
            authorizeGoogle()
              .then(({ url }) => window.location.assign(url))
              .catch((error: unknown) => {
                toast.error(errorMessage(error));
                setPending(false);
              });
          }}
        >
          <LogInIcon aria-hidden="true" />
          Conectar con Google
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">
          La conexión directa con Google aún no está disponible. Usa la exportación en archivo.
        </p>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Consulta la{" "}
        <Link to="/privacidad" className="underline">
          política de privacidad
        </Link>{" "}
        y las{" "}
        <Link to="/terminos" className="underline">
          condiciones
        </Link>
        .
      </p>
    </Section>
  );
}

function SubscriptionRow({ subscription }: { subscription: SubscriptionInfo }) {
  const queryClient = useQueryClient();
  const invalidateEvents = useInvalidateEvents();
  const [pending, setPending] = useState(false);
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY });
    await queryClient.invalidateQueries({ queryKey: CALENDARS_KEY });
    await invalidateEvents();
  };
  return (
    <li className="grid gap-2 rounded-lg border p-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <p className="flex items-center gap-2 font-medium">
          <span
            aria-hidden="true"
            className="size-3 shrink-0 rounded-full"
            style={{ backgroundColor: subscription.color }}
          />
          <span className="truncate">{subscription.name}</span>
        </p>
        <p className="truncate text-xs text-muted-foreground">{subscription.urlHint}</p>
        <p
          className={
            subscription.status === "error"
              ? "text-xs text-destructive"
              : "text-xs text-muted-foreground"
          }
        >
          {subscription.status === "error"
            ? subscription.error
            : `${plural(subscription.events, "evento", "eventos")}${
                subscription.lastSyncedAt
                  ? ` · actualizado ${dateTimeFormat.format(new Date(subscription.lastSyncedAt))}`
                  : ""
              }`}
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => {
            setPending(true);
            syncSubscription(subscription.id)
              .then(refresh)
              .catch((error: unknown) => toast.error(errorMessage(error)))
              .finally(() => setPending(false));
          }}
        >
          <RefreshCwIcon aria-hidden="true" className={pending ? "animate-spin" : undefined} />
          Sincronizar
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Quitar la suscripción ${subscription.name}`}
          disabled={pending}
          onClick={() => {
            if (
              !window.confirm(
                `¿Quitar «${subscription.name}»? Se borrará su calendario en Delyra (no el de Google).`,
              )
            )
              return;
            setPending(true);
            unsubscribe(subscription.id)
              .then(refresh)
              .catch((error: unknown) => toast.error(errorMessage(error)))
              .finally(() => setPending(false));
          }}
        >
          <Trash2Icon aria-hidden="true" />
        </Button>
      </div>
    </li>
  );
}

function Subscriptions() {
  const queryClient = useQueryClient();
  const subscriptions = useSubscriptions();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const created = await subscribe(url.trim());
      setUrl("");
      toast.success(`Suscrito a «${created.name}»`);
      await queryClient.invalidateQueries({ queryKey: SUBSCRIPTIONS_KEY });
      await queryClient.invalidateQueries({ queryKey: CALENDARS_KEY });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <Section
      id="suscripciones"
      title="Suscripción a la dirección iCal secreta"
      description={
        <>
          Mantiene un calendario de solo lectura al día (cada hora). En Google Calendar: ajustes del
          calendario → <strong>Integrar el calendario → Dirección secreta en formato iCal</strong>.
          Trátala como una contraseña.
        </>
      }
    >
      <form noValidate onSubmit={(e) => void submit(e)} className="grid gap-3">
        <FormError>{error}</FormError>
        <Field
          label="Dirección secreta en formato iCal"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <div>
          <Button type="submit" disabled={pending || url.trim() === ""}>
            {pending ? (
              <Loader2Icon aria-hidden="true" className="animate-spin" />
            ) : (
              <LinkIcon aria-hidden="true" />
            )}
            Suscribirse
          </Button>
        </div>
      </form>
      {subscriptions.data && subscriptions.data.length > 0 ? (
        <ul className="mt-4 grid gap-2">
          {subscriptions.data.map((subscription) => (
            <SubscriptionRow key={subscription.id} subscription={subscription} />
          ))}
        </ul>
      ) : null}
    </Section>
  );
}

function RecentImports({ onOpen }: { onOpen: (id: string) => void }) {
  const imports = useImports();
  const list = imports.data ?? [];
  if (list.length === 0) return null;
  const label: Record<ImportInfo["status"], string> = {
    analyzing: "Leyendo…",
    ready: "Pendiente de elegir calendarios",
    importing: "Importando…",
    succeeded: "Importada",
    failed: "Ha fallado",
    expired: "Caducada",
  };
  return (
    <Section id="recientes" title="Importaciones recientes">
      <ul className="grid gap-1 text-sm">
        {list.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onOpen(item.id)}
              className="flex w-full flex-wrap items-center justify-between gap-x-3 rounded-md px-2 py-2 text-left hover:bg-accent"
            >
              <span className="min-w-0 truncate font-medium">
                {item.source === "google" ? "Cuenta de Google" : (item.filename ?? "Archivo")}
              </span>
              <span className="text-muted-foreground">
                {label[item.status]} · {dateTimeFormat.format(new Date(item.createdAt))}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ── Asistente de una importación ─────────────────────────────────────────────

type Choice =
  | { target: "skip" }
  | { target: "new"; name: string; color: string }
  | { target: "existing"; calendarId: string };

function initialChoice(
  calendar: ImportCalendarPreview,
  index: number,
  own: readonly CalendarInfo[],
): Choice {
  if (calendar.suggestSkip) return { target: "skip" };
  if (calendar.suggestedCalendarId && own.some((c) => c.id === calendar.suggestedCalendarId)) {
    return { target: "existing", calendarId: calendar.suggestedCalendarId };
  }
  return {
    target: "new",
    name: calendar.name.slice(0, 60),
    color: calendar.color ?? CALENDAR_COLORS[index % CALENDAR_COLORS.length] ?? "#7c5cff",
  };
}

function CalendarChoice({
  calendar,
  choice,
  own,
  onChange,
}: {
  calendar: ImportCalendarPreview;
  choice: Choice;
  own: readonly CalendarInfo[];
  onChange: (choice: Choice) => void;
}) {
  const value = choice.target === "existing" ? choice.calendarId : choice.target;
  const facts = [
    plural(calendar.events, "evento", "eventos"),
    calendar.recurring > 0 ? plural(calendar.recurring, "serie", "series") : null,
    calendar.birthdays > 0 ? plural(calendar.birthdays, "cumpleaños", "cumpleaños") : null,
    calendar.withReminders > 0
      ? `${plural(calendar.withReminders, "con alerta", "con alertas")}`
      : null,
    period(calendar),
  ].filter(Boolean);
  return (
    <li className="grid gap-3 rounded-lg border p-4">
      <div>
        <p className="flex items-center gap-2 font-medium">
          {calendar.color ? (
            <span
              aria-hidden="true"
              className="size-3 rounded-full"
              style={{ backgroundColor: calendar.color }}
            />
          ) : null}
          <span className="break-words">{calendar.name}</span>
        </p>
        <p className="text-sm text-muted-foreground">{facts.join(" · ")}</p>
      </div>
      <SelectField
        label={`Destino de «${calendar.name}»`}
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          if (next === "skip") onChange({ target: "skip" });
          else if (next === "new") {
            onChange({
              target: "new",
              name: calendar.name.slice(0, 60),
              color: calendar.color ?? CALENDAR_COLORS[0],
            });
          } else onChange({ target: "existing", calendarId: next });
        }}
        options={[
          { value: "new", label: "Un calendario nuevo" },
          ...own.map((c) => ({ value: c.id, label: `Añadir a «${c.name}»` })),
          { value: "skip", label: "No importar" },
        ]}
      />
      {choice.target === "new" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Nombre del calendario nuevo"
            value={choice.name}
            maxLength={60}
            onChange={(e) => onChange({ ...choice, name: e.target.value })}
          />
          <ColorPicker value={choice.color} onChange={(color) => onChange({ ...choice, color })} />
        </div>
      ) : null}
    </li>
  );
}

function PreviewForm({ item, onDone }: { item: ImportInfo; onDone: () => void }) {
  const queryClient = useQueryClient();
  const calendars = useCalendars();
  const own = (calendars.data ?? []).filter((c) => !c.readOnly);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [reminders, setReminders] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const choiceOf = (calendar: ImportCalendarPreview, index: number) =>
    choices[calendar.key] ?? initialChoice(calendar, index, own);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body: StartImportRequest = {
      reminders,
      calendars: item.calendars.map((calendar, index) => {
        const choice = choiceOf(calendar, index);
        return choice.target === "new"
          ? { key: calendar.key, target: "new", name: choice.name.trim(), color: choice.color }
          : choice.target === "existing"
            ? { key: calendar.key, target: "existing", calendarId: choice.calendarId }
            : { key: calendar.key, target: "skip" };
      }),
    };
    if (body.calendars.every((c) => c.target === "skip")) {
      setError("Elige al menos un calendario para importar.");
      return;
    }
    if (body.calendars.some((c) => c.target === "new" && c.name === "")) {
      setError("Ponle nombre a los calendarios nuevos.");
      return;
    }
    setError(null);
    setPending(true);
    try {
      queryClient.setQueryData(importKey(item.id), await startImport(item.id, body));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  if (calendars.isPending) return <p className="text-sm text-muted-foreground">Cargando…</p>;
  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Elige dónde va cada calendario. Si repites la importación, los eventos que ya estaban se
        reconocen y no se duplican.
      </p>
      <FormError>{error}</FormError>
      <ul className="grid gap-3">
        {item.calendars.map((calendar, index) => (
          <CalendarChoice
            key={calendar.key}
            calendar={calendar}
            choice={choiceOf(calendar, index)}
            own={own}
            onChange={(choice) => setChoices((old) => ({ ...old, [calendar.key]: choice }))}
          />
        ))}
      </ul>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4 pointer-coarse:size-5"
          checked={reminders}
          onChange={(e) => setReminders(e.target.checked)}
        />
        <span>Convertir los recordatorios de Google en alertas de Telegram</span>
      </label>
      <Warnings warnings={item.warnings} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2Icon aria-hidden="true" className="animate-spin" /> : null}
          Importar
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => {
            discardImport(item.id)
              .then(async () => {
                await queryClient.invalidateQueries({ queryKey: IMPORTS_KEY });
                onDone();
              })
              .catch((caught: unknown) => toast.error(errorMessage(caught)));
          }}
        >
          Descartar
        </Button>
      </div>
    </form>
  );
}

function Warnings({ warnings }: { warnings: readonly string[] }) {
  if (warnings.length === 0) return null;
  return (
    <details className="rounded-lg border bg-muted/40 p-3 text-sm">
      <summary className="flex cursor-pointer items-center gap-2 font-medium">
        <TriangleAlertIcon aria-hidden="true" className="size-4 text-amber-600" />
        {plural(warnings.length, "aviso", "avisos")} sobre el contenido
      </summary>
      <ul className="mt-2 list-disc pl-5 text-muted-foreground">
        {warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </details>
  );
}

function Progress({ done, total, label }: { done: number; total: number; label: string }) {
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="grid gap-2" role="status" aria-live="polite">
      <p className="flex items-center gap-2 text-sm">
        <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />
        {label}
      </p>
      {total > 0 ? (
        <>
          <div
            className="h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label="Progreso de la importación"
          >
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${String(percent)}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {done.toLocaleString("es-ES")} de {plural(total, "evento", "eventos")}
          </p>
        </>
      ) : null}
    </div>
  );
}

function Report({ item }: { item: ImportInfo }) {
  const report = item.report;
  if (!report) return null;
  return (
    <div className="grid gap-4">
      <p className="flex items-center gap-2 font-medium">
        <CheckCircle2Icon aria-hidden="true" className="size-5 text-green-600" />
        Importación terminada
      </p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Nuevos", report.created],
          ["Actualizados", report.updated],
          ["Ya estaban", report.unchanged],
          ["Descartados", report.skipped],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg border p-3">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-xl font-semibold">{Number(value).toLocaleString("es-ES")}</dd>
          </div>
        ))}
      </dl>
      {report.calendars.length > 1 ? (
        <ul className="grid gap-1 text-sm">
          {report.calendars.map((calendar) => (
            <li key={calendar.key}>
              <span className="font-medium">{calendar.name}</span>:{" "}
              {[
                plural(calendar.created, "nuevo", "nuevos"),
                plural(calendar.updated, "actualizado", "actualizados"),
                plural(calendar.unchanged, "sin cambios", "sin cambios"),
              ].join(", ")}
            </li>
          ))}
        </ul>
      ) : null}
      <Warnings warnings={report.warnings} />
    </div>
  );
}

function ImportWizard({ id, onBack }: { id: string; onBack: () => void }) {
  const query = useImport(id);
  const queryClient = useQueryClient();
  const refreshed = useRef(false);
  const item = query.data;
  const status = item?.status;
  // Al terminar, el calendario (y su lista de calendarios) se vuelve a pedir una vez.
  useEffect(() => {
    if (status !== "succeeded" || refreshed.current) return;
    refreshed.current = true;
    void queryClient.invalidateQueries({ queryKey: CALENDARS_KEY });
    void queryClient.invalidateQueries({ queryKey: EVENTS_KEY });
  }, [status, queryClient]);

  const title =
    item?.source === "google"
      ? "Importar tu cuenta de Google"
      : `Importar ${item?.filename ?? "el archivo"}`;
  return (
    <Section id="importacion" title={title}>
      {query.isError ? <FormError>{errorMessage(query.error)}</FormError> : null}
      {!item ? (
        query.isPending ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : null
      ) : item.status === "analyzing" ? (
        <Progress
          done={0}
          total={0}
          label={
            item.source === "google"
              ? "Descargando tus calendarios de Google…"
              : "Leyendo el archivo…"
          }
        />
      ) : item.status === "ready" ? (
        <PreviewForm item={item} onDone={onBack} />
      ) : item.status === "importing" ? (
        <Progress
          done={item.progress.done}
          total={item.progress.total}
          label="Importando eventos…"
        />
      ) : item.status === "succeeded" ? (
        <Report item={item} />
      ) : (
        <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
          <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {item.status === "expired"
            ? "Esta vista previa ha caducado. Vuelve a subir el archivo o a conectar con Google."
            : (item.error ?? "La importación ha fallado.")}
        </p>
      )}
      {item &&
      item.status !== "ready" &&
      item.status !== "analyzing" &&
      item.status !== "importing" ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {item.status === "succeeded" ? (
            <Button asChild>
              <Link to="/">Ver el calendario</Link>
            </Button>
          ) : null}
          <Button variant="outline" onClick={onBack}>
            Importar otra cosa
          </Button>
        </div>
      ) : null}
    </Section>
  );
}

// ── Página ───────────────────────────────────────────────────────────────────

export function ImportPage() {
  const router = useRouter();
  const logout = useLogout();
  const { searchStr } = useLocation();
  const params = new URLSearchParams(searchStr);
  const importId = params.get("import");
  const google = params.get("google");
  const open = (id: string | null) =>
    router.history.push(id ? `/importar?import=${encodeURIComponent(id)}` : "/importar");

  return (
    <RequireSession navigate={(path) => router.history.replace(path)}>
      {(session) => (
        <AppShell app="calendar" user={session.user} onSignOut={() => logout.mutate()}>
          <div className="mx-auto grid max-w-3xl gap-6">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                Importar desde Google Calendar
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Trae tus calendarios, eventos, repeticiones, colores y recordatorios.
              </p>
            </div>
            {google && GOOGLE_MESSAGES[google] ? (
              <p
                role="alert"
                className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
              >
                {GOOGLE_MESSAGES[google]}
              </p>
            ) : null}
            {importId ? (
              <ImportWizard key={importId} id={importId} onBack={() => open(null)} />
            ) : (
              <>
                <FileImport onStarted={open} />
                <GoogleConnect />
                <Subscriptions />
                <RecentImports onOpen={open} />
              </>
            )}
          </div>
        </AppShell>
      )}
    </RequireSession>
  );
}
