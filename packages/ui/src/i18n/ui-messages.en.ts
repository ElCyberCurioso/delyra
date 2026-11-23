import type { Translation } from "./core";
import type { UiMessages } from "./ui-messages";

const en: Translation<UiMessages> = {
  common: {
    loading: "Loading…",
    retry: "Try again",
    close: "Close",
    redirectingToLogin: "Redirecting to sign in…",
  },
  notFound: {
    title: "Page not found",
    description: "The address doesn't exist or has changed.",
    boards: "Go to my boards",
    loadingBoard: "Loading board…",
  },
  errors: {
    tooManyAttempts: "Too many attempts. Wait a few minutes and try again.",
    offline: "Can't reach the server.",
    generic: "Something went wrong. Please try again.",
    apiStatus: (status) => `The API responded HTTP ${String(status)}`,
  },
  shell: {
    skipToContent: "Skip to content",
    apps: "Apps",
    calendar: "Calendar",
    work: "Work",
  },
  userMenu: {
    label: "User menu",
    signedOut: "Signed out",
    settings: "Settings",
    admin: "Administration",
    theme: "Theme",
    light: "Light",
    dark: "Dark",
    system: "System",
    language: "Language",
    signOut: "Sign out",
  },
  language: {
    switchTo: "Change language",
  },
  shortcuts: {
    title: "Keyboard shortcuts",
    description: "They work when you're not typing in a field.",
  },
  pwa: {
    newVersion: "A new version of Delyra is available",
    update: "Update",
  },
  health: {
    title: "Platform status",
    checking: "Checking…",
    noApi: "Can't reach the API",
    ok: "Operational",
    degraded: "Degraded",
    error: "Error",
    version: "Version",
    d1: "Database (D1)",
    r2: "Storage (R2)",
    queues: "Queues",
    development: "Local",
    production: "Production",
  },
};

export default en;
