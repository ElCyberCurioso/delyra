import type { Logger } from "../lib/logger";

/**
 * Envío de correo (F1-12) detrás de una interfaz para poder cambiar de proveedor.
 * - Producción con el binding `EMAIL` (Email Service, P-07): envío real.
 * - Producción sin binding: no disponible; quien llama decide qué hacer (p. ej. mostrar el enlace
 *   de invitación al administrador).
 * - Desarrollo y tests: no sale nada; el mensaje queda en `devOutbox` y se imprime en consola.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  readonly available: boolean;
  send(message: EmailMessage): Promise<void>;
}

class MailerUnavailableError extends Error {
  override name = "MailerUnavailableError";
}

/** Bandeja de salida de desarrollo (los tests la leen para obtener enlaces). */
export const devOutbox: EmailMessage[] = [];

export function createMailer(
  env: Pick<Env, "APP_ENV" | "MAIL_FROM" | "EMAIL">,
  logger: Logger,
): Mailer {
  if (env.APP_ENV !== "production") {
    return {
      available: true,
      send(message) {
        devOutbox.push(message);
        if (devOutbox.length > 50) devOutbox.shift();
        // Solo en desarrollo: el contenido (con enlaces de un solo uso) se ve en la consola.
        // eslint-disable-next-line no-console
        console.log(
          `\n[correo de desarrollo] Para: ${message.to}\nAsunto: ${message.subject}\n\n${message.text}\n`,
        );
        return Promise.resolve();
      },
    };
  }

  const binding = env.EMAIL;
  if (!binding) {
    return {
      available: false,
      send() {
        return Promise.reject(new MailerUnavailableError("Email Service no está configurado"));
      },
    };
  }

  return {
    available: true,
    async send(message) {
      try {
        await binding.send({
          from: { email: env.MAIL_FROM, name: "Delyra" },
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
        });
      } catch (error) {
        logger.error("email_send_failed", {
          errorName: error instanceof Error ? error.name : "NonError",
        });
        throw error;
      }
    },
  };
}
