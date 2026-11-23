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
  intlLocale,
  SelectField,
  toast,
  translateServer,
  useAccountPreferences,
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
import { CalendarColorPicker } from "../calendar/calendar-list";
import { Section } from "../settings/section";
import { importMessages } from "./messages";
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

function googleMessage(code: string): string | null {
  const messages: Readonly<Record<string, string>> = importMessages().google;
  return messages[code] ?? null;
}

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat(intlLocale(), { dateStyle: "medium" }).format(new Date(iso));
const formatDateTime = (iso: string) =>
  new Intl.DateTimeFormat(intlLocale(), { dateStyle: "short", timeStyle: "short" }).format(
    new Date(iso),
  );

function period(calendar: ImportCalendarPreview): string | null {
  if (!calendar.firstStart || !calendar.lastStart) return null;
  const first = formatDate(calendar.firstStart);
  const last = formatDate(calendar.lastStart);
  return first === last ? first : `${first} – ${last}`;
}

// ── Elegir origen ────────────────────────────────────────────────────────────

function FileImport({ onStarted }: { onStarted: (id: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const t = importMessages().file;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) {
      setError(t.missing);
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
      title={t.title}
      description={
        <>
          {t.open} <strong>{t.path}</strong>
          {t.after}
        </>
      }
    >
      <form noValidate onSubmit={(e) => void submit(e)} className="grid gap-3">
        <FormError>{error}</FormError>
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">{t.label}</span>
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
            {t.upload}
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
  const t = importMessages().account;
  return (
    <Section id="cuenta" title={t.title} description={t.description}>
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
          {t.connect}
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">{t.unavailable}</p>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        {t.see}{" "}
        <Link to="/privacidad" className="underline">
          {t.privacy}
        </Link>{" "}
        {t.and}{" "}
        <Link to="/terminos" className="underline">
          {t.terms}
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
  const t = importMessages();
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
            ? translateServer(subscription.error ?? "")
            : `${t.counts.events(subscription.events)}${
                subscription.lastSyncedAt
                  ? t.subscriptions.updated(formatDateTime(subscription.lastSyncedAt))
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
          {t.subscriptions.sync}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t.subscriptions.remove(subscription.name)}
          disabled={pending}
          onClick={() => {
            if (!window.confirm(t.subscriptions.confirmRemove(subscription.name))) return;
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
  const t = importMessages().subscriptions;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const created = await subscribe(url.trim());
      setUrl("");
      toast.success(t.subscribed(created.name));
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
      title={t.title}
      description={
        <>
          {t.intro} <strong>{t.path}</strong>
          {t.password}
        </>
      }
    >
      <form noValidate onSubmit={(e) => void submit(e)} className="grid gap-3">
        <FormError>{error}</FormError>
        <Field
          label={t.address}
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
            {t.subscribe}
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
  const t = importMessages().recent;
  return (
    <Section id="recientes" title={t.title}>
      <ul className="grid gap-1 text-sm">
        {list.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onOpen(item.id)}
              className="flex w-full flex-wrap items-center justify-between gap-x-3 rounded-md px-2 py-2 text-left hover:bg-accent"
            >
              <span className="min-w-0 truncate font-medium">
                {item.source === "google" ? t.google : (item.filename ?? t.file)}
              </span>
              <span className="text-muted-foreground">
                {t.status[item.status]} · {formatDateTime(item.createdAt)}
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
  const t = importMessages();
  const facts = [
    t.counts.events(calendar.events),
    calendar.recurring > 0 ? t.counts.series(calendar.recurring) : null,
    calendar.birthdays > 0 ? t.counts.birthdays(calendar.birthdays) : null,
    calendar.withReminders > 0 ? t.counts.withReminders(calendar.withReminders) : null,
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
        label={t.preview.destination(calendar.name)}
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
          { value: "new", label: t.preview.newCalendar },
          ...own.map((c) => ({ value: c.id, label: t.preview.addTo(c.name) })),
          { value: "skip", label: t.preview.skip },
        ]}
      />
      {choice.target === "new" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t.preview.newName}
            value={choice.name}
            maxLength={60}
            onChange={(e) => onChange({ ...choice, name: e.target.value })}
          />
          <CalendarColorPicker
            value={choice.color}
            onChange={(color) => onChange({ ...choice, color })}
          />
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
  const t = importMessages().preview;
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
      setError(t.chooseOne);
      return;
    }
    if (body.calendars.some((c) => c.target === "new" && c.name === "")) {
      setError(t.nameNew);
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

  if (calendars.isPending) return <p className="text-sm text-muted-foreground">{t.loading}</p>;
  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="grid gap-4">
      <p className="text-sm text-muted-foreground">{t.intro}</p>
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
        <span>{t.reminders}</span>
      </label>
      <Warnings warnings={item.warnings} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2Icon aria-hidden="true" className="animate-spin" /> : null}
          {t.import}
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
          {t.discard}
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
        {importMessages().counts.warnings(warnings.length)} {importMessages().preview.aboutContent}
      </summary>
      <ul className="mt-2 list-disc pl-5 text-muted-foreground">
        {warnings.map((warning) => (
          <li key={warning}>{translateServer(warning)}</li>
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
            aria-label={importMessages().progress.label}
          >
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${String(percent)}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {importMessages().progress.of(done, importMessages().counts.events(total))}
          </p>
        </>
      ) : null}
    </div>
  );
}

function Report({ item }: { item: ImportInfo }) {
  const report = item.report;
  if (!report) return null;
  const t = importMessages();
  return (
    <div className="grid gap-4">
      <p className="flex items-center gap-2 font-medium">
        <CheckCircle2Icon aria-hidden="true" className="size-5 text-green-600" />
        {t.report.done}
      </p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          [t.report.created, report.created],
          [t.report.updated, report.updated],
          [t.report.unchanged, report.unchanged],
          [t.report.skipped, report.skipped],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg border p-3">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-xl font-semibold">{Number(value).toLocaleString(intlLocale())}</dd>
          </div>
        ))}
      </dl>
      {report.calendars.length > 1 ? (
        <ul className="grid gap-1 text-sm">
          {report.calendars.map((calendar) => (
            <li key={calendar.key}>
              <span className="font-medium">{calendar.name}</span>:{" "}
              {[
                t.counts.created(calendar.created),
                t.counts.updated(calendar.updated),
                t.counts.unchanged(calendar.unchanged),
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

  const t = importMessages().wizard;
  const title = item?.source === "google" ? t.google : t.file(item?.filename ?? t.theFile);
  return (
    <Section id="importacion" title={title}>
      {query.isError ? <FormError>{errorMessage(query.error)}</FormError> : null}
      {!item ? (
        query.isPending ? (
          <p className="text-sm text-muted-foreground">{importMessages().preview.loading}</p>
        ) : null
      ) : item.status === "analyzing" ? (
        <Progress done={0} total={0} label={item.source === "google" ? t.downloading : t.reading} />
      ) : item.status === "ready" ? (
        <PreviewForm item={item} onDone={onBack} />
      ) : item.status === "importing" ? (
        <Progress done={item.progress.done} total={item.progress.total} label={t.importing} />
      ) : item.status === "succeeded" ? (
        <Report item={item} />
      ) : (
        <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
          <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {item.status === "expired"
            ? t.expired
            : item.error
              ? translateServer(item.error)
              : t.failed}
        </p>
      )}
      {item &&
      item.status !== "ready" &&
      item.status !== "analyzing" &&
      item.status !== "importing" ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {item.status === "succeeded" ? (
            <Button asChild>
              <Link to="/">{t.view}</Link>
            </Button>
          ) : null}
          <Button variant="outline" onClick={onBack}>
            {t.another}
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
  const preferences = useAccountPreferences();
  const { searchStr } = useLocation();
  const params = new URLSearchParams(searchStr);
  const importId = params.get("import");
  const google = params.get("google");
  const open = (id: string | null) =>
    router.history.push(id ? `/importar?import=${encodeURIComponent(id)}` : "/importar");

  return (
    <RequireSession navigate={(path) => router.history.replace(path)}>
      {(session) => (
        <AppShell
          app="calendar"
          user={session.user}
          onSignOut={() => logout.mutate()}
          {...preferences}
        >
          <div className="mx-auto grid max-w-3xl gap-6">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {importMessages().page.title}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">{importMessages().page.intro}</p>
            </div>
            {google && googleMessage(google) ? (
              <p
                role="alert"
                className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
              >
                {googleMessage(google)}
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
