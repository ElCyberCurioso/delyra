import type { Translation } from "@delyra/ui";
import type { ImportMessages } from "./messages";

const count = (n: number, one: string, many: string) =>
  `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

const en: Translation<ImportMessages> = {
  google: {
    denied: "You cancelled the connection with Google. Nothing was imported.",
    state: "Google's response wasn't valid or had expired. Press “Connect with Google” again.",
    busy: "You already have an import running. Wait for it to finish.",
    error: "Couldn't connect with Google. Please try again.",
    "offline-denied":
      "Google didn't give permanent permission, so syncing isn't possible. Connect again and accept all the permissions.",
  },
  counts: {
    events: (n) => count(n, "event", "events"),
    series: (n) => count(n, "series", "series"),
    birthdays: (n) => count(n, "birthday", "birthdays"),
    withReminders: (n) => count(n, "with an alert", "with alerts"),
    warnings: (n) => count(n, "warning", "warnings"),
    created: (n) => count(n, "new", "new"),
    updated: (n) => count(n, "updated", "updated"),
    unchanged: (n) => count(n, "unchanged", "unchanged"),
  },
  file: {
    missing: "Choose the .zip or .ics you exported.",
    title: "From an exported file",
    open: "In Google Calendar, open",
    path: "Settings → Import & export → Export",
    after: ". You'll download a .zip with one .ics per calendar. A single .ics works too.",
    label: "File (.zip or .ics, up to 25 MB)",
    upload: "Upload and see what's inside",
  },
  account: {
    title: "From your Google account",
    description:
      "Delyra reads your calendars, colours, events and reminders once, with read-only permission. It doesn't keep any permanent access to your account.",
    connect: "Connect with Google",
    unavailable: "The direct connection with Google isn't available yet. Use the file export.",
    see: "See the",
    privacy: "privacy policy",
    and: "and the",
    terms: "terms",
  },
  sync: {
    title: "Sync with Google",
    description:
      "Keeps the Google calendars you choose up to date every 15 minutes. In Delyra they're read-only: edit them in Google.",
    connect: "Connect to sync",
    reconnect: "Connect again",
    permanentNote:
      "To sync, Delyra stores (encrypted) a permanent read-only permission. You can disconnect whenever you like and it's revoked in Google.",
    connected: "Google account connected. Choose which calendars to sync.",
    connectedAs: (email) => `Connected as ${email}.`,
    yourAccount: "your Google account",
    revoked:
      "Google has withdrawn Delyra's permission (or it expired). Syncing is paused until you connect again.",
    listLabel: "Synced calendars",
    syncing: "Syncing…",
    loadingCalendars: "Loading your Google calendars…",
    allSynced: "You already sync all your Google calendars.",
    calendar: "Google calendar",
    notRecommended: (name) => `${name} (not recommended)`,
    reminders: "Turn its reminders into Delyra alerts",
    add: "Sync this calendar",
    added: "Sync added. You'll see its events in a moment.",
    remove: (name) => `Stop syncing ${name}`,
    confirmRemove: (name) =>
      `Stop syncing “${name}”? Its copy in Delyra will be deleted (not the Google calendar).`,
    disconnect: "Disconnect Google",
    confirmDisconnect: (n) =>
      n === 0
        ? "Disconnect your Google account? Delyra's permission will be revoked."
        : `Disconnect your Google account? The permission will be revoked and ${String(n)} synced ${n === 1 ? "calendar" : "calendars"} will be deleted from Delyra (they stay in Google).`,
    disconnected: "Google account disconnected",
  },
  subscriptions: {
    updated: (when) => ` · updated ${when}`,
    sync: "Sync",
    remove: (name) => `Remove the subscription ${name}`,
    confirmRemove: (name) =>
      `Remove “${name}”? Its calendar in Delyra will be deleted (not the one in Google).`,
    subscribed: (name) => `Subscribed to “${name}”`,
    title: "Subscription to the secret iCal address",
    intro: "Keeps a read-only calendar up to date (every hour). In Google Calendar:",
    path: "calendar settings → Integrate calendar → Secret address in iCal format",
    password: ". Treat it like a password.",
    address: "Secret address in iCal format",
    subscribe: "Subscribe",
  },
  recent: {
    title: "Recent imports",
    status: {
      analyzing: "Reading…",
      ready: "Waiting for you to choose calendars",
      importing: "Importing…",
      succeeded: "Imported",
      failed: "Failed",
      expired: "Expired",
    },
    google: "Google account",
    file: "File",
  },
  preview: {
    destination: (name) => `Destination for “${name}”`,
    newCalendar: "A new calendar",
    addTo: (name) => `Add to “${name}”`,
    skip: "Don't import",
    newName: "Name of the new calendar",
    chooseOne: "Choose at least one calendar to import.",
    nameNew: "Give the new calendars a name.",
    loading: "Loading…",
    intro:
      "Choose where each calendar goes. If you import again, events that were already there are recognised and not duplicated.",
    reminders: "Turn Google reminders into Telegram alerts",
    import: "Import",
    discard: "Discard",
    aboutContent: "about the content",
  },
  progress: {
    label: "Import progress",
    of: (done, total) => `${done.toLocaleString("en-GB")} of ${total}`,
  },
  report: {
    done: "Import finished",
    created: "New",
    updated: "Updated",
    unchanged: "Already there",
    skipped: "Skipped",
  },
  wizard: {
    google: "Import your Google account",
    file: (name) => `Import ${name}`,
    theFile: "the file",
    downloading: "Downloading your Google calendars…",
    reading: "Reading the file…",
    importing: "Importing events…",
    expired: "This preview has expired. Upload the file again or reconnect with Google.",
    failed: "The import failed.",
    view: "See the calendar",
    another: "Import something else",
  },
  page: {
    title: "Import from Google Calendar",
    intro: "Bring your calendars, events, repeats, colours and reminders.",
  },
};

export default en;
