import type { Locale } from "@delyra/shared";
import type { EmailMessage } from "./mailer";

/** Plantillas de correo de Delyra en español e inglés (F1-12). */

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function layout(title: string, paragraphs: string[], action?: { label: string; url: string }) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px">${escapeHtml(p)}</p>`).join("");
  const button = action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="background:#5b3fd6;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(action.label)}</a></p><p style="margin:0 0 16px;font-size:13px;color:#666;word-break:break-all">${escapeHtml(action.url)}</p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f6f5fb;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1f1a33"><div style="max-width:520px;margin:0 auto;padding:32px 24px"><p style="font-weight:700;font-size:18px;margin:0 0 24px">Delyra</p><h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h1>${body}${button}<p style="margin:32px 0 0;font-size:12px;color:#888">Delyra · delyra.app</p></div></body></html>`;
}

function message(
  to: string,
  subject: string,
  title: string,
  paragraphs: string[],
  action?: { label: string; url: string },
): EmailMessage {
  const text = [
    title,
    "",
    ...paragraphs,
    ...(action ? ["", `${action.label}: ${action.url}`] : []),
  ].join("\n");
  return { to, subject, text, html: layout(title, paragraphs, action) };
}

function formatDate(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "es" ? "es-ES" : "en-GB", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Madrid",
  }).format(date);
}

export function invitationEmail(to: string, link: string, expiresAt: Date, locale: Locale = "es") {
  return locale === "es"
    ? message(
        to,
        "Te han invitado a Delyra",
        "Tu invitación a Delyra",
        [
          "Te han invitado a crear una cuenta en Delyra, el calendario y gestor de tareas.",
          `El enlace es personal, sirve una sola vez y caduca el ${formatDate(expiresAt, locale)}.`,
          "Si no esperabas esta invitación, ignora este correo.",
        ],
        { label: "Crear mi cuenta", url: link },
      )
    : message(
        to,
        "You have been invited to Delyra",
        "Your Delyra invitation",
        [
          "You have been invited to create a Delyra account (calendar and task manager).",
          `This personal link works once and expires on ${formatDate(expiresAt, locale)}.`,
          "If you were not expecting this invitation, ignore this email.",
        ],
        { label: "Create my account", url: link },
      );
}

export function passwordResetEmail(to: string, link: string, locale: Locale = "es") {
  return locale === "es"
    ? message(
        to,
        "Restablece tu contraseña de Delyra",
        "Restablecer la contraseña",
        [
          "Has pedido restablecer la contraseña de tu cuenta de Delyra.",
          "El enlace sirve una sola vez y caduca en 30 minutos. Al cambiarla se cerrarán todas tus sesiones; tu verificación en dos pasos se mantiene.",
          "Si no lo has pedido tú, ignora este correo: tu contraseña no cambia.",
        ],
        { label: "Elegir una contraseña nueva", url: link },
      )
    : message(
        to,
        "Reset your Delyra password",
        "Reset your password",
        [
          "You asked to reset the password of your Delyra account.",
          "This link works once and expires in 30 minutes. Changing it signs you out everywhere; two-step verification stays enabled.",
          "If you did not ask for this, ignore this email: your password does not change.",
        ],
        { label: "Choose a new password", url: link },
      );
}

export function newLoginEmail(
  to: string,
  details: { at: Date; country: string | null; userAgent: string | null },
  locale: Locale = "es",
) {
  const where = details.country ?? (locale === "es" ? "ubicación desconocida" : "unknown location");
  const device =
    details.userAgent ?? (locale === "es" ? "dispositivo desconocido" : "unknown device");
  return locale === "es"
    ? message(to, "Nuevo inicio de sesión en Delyra", "Nuevo inicio de sesión", [
        `Se ha iniciado sesión en tu cuenta el ${formatDate(details.at, locale)} desde ${where}.`,
        `Dispositivo: ${device}.`,
        "Si no has sido tú, cambia tu contraseña y cierra las demás sesiones desde Ajustes → Seguridad.",
      ])
    : message(to, "New sign-in to Delyra", "New sign-in", [
        `Your account was signed in on ${formatDate(details.at, locale)} from ${where}.`,
        `Device: ${device}.`,
        "If this was not you, change your password and sign out other sessions in Settings → Security.",
      ]);
}

export function backupFailedEmail(to: string, error: string) {
  return message(to, "Fallo del backup diario de Delyra", "El backup diario ha fallado", [
    "El Workflow de backup del sistema no ha podido completar el volcado de D1.",
    `Error: ${error}`,
    "Revisa docs/runbooks/backup-sistema.md.",
  ]);
}
