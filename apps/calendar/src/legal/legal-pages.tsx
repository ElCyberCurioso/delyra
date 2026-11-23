import { Brand, getLocale, LanguageSwitch } from "@delyra/ui";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { PrivacyEn, TermsEn } from "./legal-en";

/**
 * Páginas públicas que exige la pantalla de consentimiento de Google (F5-04): política de
 * privacidad y condiciones de uso. No necesitan sesión. En español e inglés (F7-06).
 */

const COPY = {
  es: {
    updated: "Última actualización: 22 de noviembre de 2026",
    nav: "Páginas legales",
    privacy: "Privacidad",
    terms: "Condiciones",
    privacyTitle: "Política de privacidad",
    termsTitle: "Condiciones de uso",
  },
  en: {
    updated: "Last updated: 22 November 2026",
    nav: "Legal pages",
    privacy: "Privacy",
    terms: "Terms",
    privacyTitle: "Privacy policy",
    termsTitle: "Terms of use",
  },
} as const;

const copy = () => COPY[getLocale()];

function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  const t = copy();
  return (
    <div className="min-h-dvh bg-background px-4 py-8 text-foreground">
      <div className="mx-auto max-w-2xl">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <Brand href="/" />
          <nav aria-label={t.nav} className="flex gap-4 text-sm">
            <Link to="/privacidad" className="text-muted-foreground hover:text-foreground">
              {t.privacy}
            </Link>
            <Link to="/terminos" className="text-muted-foreground hover:text-foreground">
              {t.terms}
            </Link>
          </nav>
        </header>
        <main
          id="contenido"
          className="grid gap-5 text-sm leading-relaxed [&_h2]:mt-3 [&_h2]:text-base [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc"
        >
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-1 text-muted-foreground">{t.updated}</p>
          </div>
          {children}
        </main>
        <LanguageSwitch className="mt-10" />
      </div>
    </div>
  );
}

export function PrivacyPage() {
  return (
    <LegalLayout title={copy().privacyTitle}>
      {getLocale() === "en" ? <PrivacyEn /> : <PrivacyEs />}
    </LegalLayout>
  );
}

export function TermsPage() {
  return (
    <LegalLayout title={copy().termsTitle}>
      {getLocale() === "en" ? <TermsEn /> : <TermsEs />}
    </LegalLayout>
  );
}

function PrivacyEs() {
  return (
    <>
      <p>
        Delyra es un calendario y gestor de tareas personal de uso privado, con acceso solo por
        invitación. Esta página explica qué datos trata y para qué.
      </p>

      <h2>Datos que guarda Delyra</h2>
      <ul>
        <li>
          Tu cuenta: nombre, email, contraseña (solo su hash) y el segundo factor (cifrado). Si
          añades llaves de acceso, solo su clave pública y el nombre que les pongas: la huella, la
          cara o el PIN nunca salen de tu dispositivo.
        </li>
        <li>Lo que creas: calendarios, eventos, alertas, tableros, tarjetas y adjuntos.</li>
        <li>
          Si vinculas Telegram, el identificador de tu chat (cifrado), para enviarte las alertas.
        </li>
        <li>Registros técnicos de seguridad (inicios de sesión, cambios en la cuenta).</li>
      </ul>

      <h2>Datos de Google</h2>
      <p>
        Solo si tú lo pides, Delyra se conecta a tu cuenta de Google con el permiso de{" "}
        <strong>solo lectura del calendario</strong> (<code>calendar.readonly</code>) para importar
        una vez tus calendarios (nombre, color y zona horaria), sus eventos (con sus repeticiones) y
        sus recordatorios.
      </p>
      <ul>
        <li>
          No se guarda ningún permiso permanente: Delyra no recibe ni almacena un token de
          actualización. El token de acceso temporal (una hora como máximo) se guarda cifrado solo
          mientras se descargan los calendarios y se borra al terminar.
        </li>
        <li>
          Los datos descargados se guardan de forma temporal (como mucho 7 días) hasta que eliges
          qué importar, y se borran al acabar la importación.
        </li>
        <li>
          Lo importado pasa a ser parte de tu calendario en Delyra y solo lo ves tú. No se vende, no
          se comparte con terceros, no se usa para publicidad ni para entrenar modelos de IA.
        </li>
        <li>
          El uso de la información recibida de las API de Google se ajusta a la{" "}
          <a
            className="underline"
            href="https://developers.google.com/terms/api-services-user-data-policy"
            rel="noopener noreferrer"
            target="_blank"
          >
            Política de datos de usuario de los servicios de API de Google
          </a>
          , incluidos los requisitos de uso limitado.
        </li>
      </ul>
      <p>
        Si te suscribes a la dirección iCal secreta de un calendario, Delyra guarda esa dirección
        cifrada y la consulta cada hora para mantener al día una copia de solo lectura. Puedes
        quitar la suscripción en cualquier momento.
      </p>

      <h2>Dictado por voz</h2>
      <p>
        Si usas el micrófono para el alta rápida, la voz la convierte en texto el servicio de
        dictado de tu navegador (en Chrome, el de Google; en Safari, el de Apple). Delyra no recibe
        ni guarda el audio: solo el texto que aparece en el campo, y únicamente si decides añadir el
        evento.
      </p>

      <h2>Dónde se guardan</h2>
      <p>
        En la infraestructura de Cloudflare (base de datos y almacenamiento en la Unión Europea),
        con copias de seguridad cifradas en reposo que se conservan 30 días.
      </p>

      <h2>Tus derechos</h2>
      <p>
        Puedes borrar en cualquier momento lo importado (borrando el calendario), revocar el acceso
        de Delyra desde{" "}
        <a
          className="underline"
          href="https://myaccount.google.com/permissions"
          rel="noopener noreferrer"
          target="_blank"
        >
          tu cuenta de Google
        </a>{" "}
        y pedir la exportación o el borrado de tu cuenta a quien te invitó a Delyra.
      </p>
    </>
  );
}

function TermsEs() {
  return (
    <>
      <p>
        Delyra es un servicio privado, gratuito y solo por invitación. Al usarlo aceptas estas
        condiciones.
      </p>
      <h2>Uso</h2>
      <ul>
        <li>Tu cuenta es personal: protege tu contraseña y tu segundo factor.</li>
        <li>No subas contenido ilegal ni intentes acceder a datos de otras personas.</li>
        <li>
          Las importaciones desde Google son a petición tuya y solo leen los calendarios de la
          cuenta con la que te conectas.
        </li>
      </ul>
      <h2>Servicio</h2>
      <ul>
        <li>
          Se ofrece «tal cual», sin garantías de disponibilidad. Las alertas por Telegram dependen
          de servicios de terceros y pueden retrasarse.
        </li>
        <li>Se hacen copias de seguridad, pero conviene que exportes lo que te importe.</li>
        <li>
          El acceso puede retirarse si se incumplen estas condiciones. Puedes dejar de usar Delyra y
          pedir el borrado de tus datos cuando quieras.
        </li>
      </ul>
      <p>
        Consulta también la{" "}
        <Link to="/privacidad" className="underline">
          política de privacidad
        </Link>
        .
      </p>
    </>
  );
}
