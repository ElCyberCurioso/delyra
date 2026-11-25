import { Brand, getLocale, LanguageSwitch } from "@delyra/ui";
import { Link, useLocation } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AccountDeletionEn, PrivacyEn, TermsEn } from "./legal-en";

/**
 * Páginas públicas que exige la pantalla de consentimiento de Google (F5-04): política de
 * privacidad y condiciones de uso. No necesitan sesión. En español e inglés (F7-06).
 * F8-12: cómo eliminar la cuenta (`/borrar-cuenta`, la URL que pide Google Play).
 */

const COPY = {
  es: {
    updated: "Última actualización: 26 de noviembre de 2026",
    nav: "Páginas legales",
    privacy: "Privacidad",
    terms: "Condiciones",
    privacyTitle: "Política de privacidad",
    termsTitle: "Condiciones de uso",
    deletionTitle: "Eliminar tu cuenta de Delyra",
  },
  en: {
    updated: "Last updated: 26 November 2026",
    nav: "Legal pages",
    privacy: "Privacy",
    terms: "Terms",
    privacyTitle: "Privacy policy",
    termsTitle: "Terms of use",
    deletionTitle: "Delete your Delyra account",
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

export function AccountDeletionPage() {
  // `?hecho=1`: se acaba de eliminar la cuenta desde Ajustes.
  const done = new URLSearchParams(useLocation().searchStr).has("hecho");
  return (
    <LegalLayout title={copy().deletionTitle}>
      {getLocale() === "en" ? <AccountDeletionEn done={done} /> : <AccountDeletionEs done={done} />}
    </LegalLayout>
  );
}

function AccountDeletionEs({ done }: { done: boolean }) {
  return (
    <>
      {done ? (
        <p role="status" className="rounded-xl border border-border bg-card p-3 font-medium">
          Tu cuenta se ha eliminado. Te hemos enviado un correo para confirmarlo.
        </p>
      ) : null}
      <p>
        Puedes eliminar tu cuenta de Delyra cuando quieras, tú mismo, desde la web o desde la app de
        Android. Se borra al momento y no se puede deshacer.
      </p>

      <h2>Cómo hacerlo</h2>
      <ul>
        <li>
          En la web: entra en delyra.app y ve a{" "}
          <Link to="/ajustes" hash="eliminar" className="underline">
            Ajustes → Eliminar la cuenta
          </Link>
          .
        </li>
        <li>En la app de Android: Ajustes → Eliminar la cuenta.</li>
        <li>
          Te pedirá tu contraseña y el código de tu app autenticadora (o uno de recuperación).
        </li>
        <li>
          Si no puedes entrar, recupera la contraseña con «¿Has olvidado tu contraseña?». Si has
          perdido el segundo factor y los códigos de recuperación, pide a quien te invitó que lo
          restablezca desde la administración de Delyra.
        </li>
      </ul>

      <h2>Qué se borra</h2>
      <ul>
        <li>
          Tu cuenta: nombre, email, contraseña, segundo factor, llaves de acceso, sesiones e
          historial de seguridad.
        </li>
        <li>
          Lo que has creado: calendarios, eventos, alertas, tableros, tarjetas, adjuntos y tus
          copias de seguridad. Los tableros que compartías se borran también para las personas con
          las que los compartías.
        </li>
        <li>
          Las conexiones con Google (se revoca el permiso), Microsoft 365 y Telegram, y tus
          suscripciones iCal.
        </li>
      </ul>

      <h2>Qué queda</h2>
      <ul>
        <li>Los comentarios que dejaste en tableros de otras personas, sin tu nombre.</li>
        <li>
          Las copias de seguridad del sistema, que caducan solas: como mucho, en un año (ver la{" "}
          <Link to="/privacidad" className="underline">
            política de privacidad
          </Link>
          ).
        </li>
      </ul>
    </>
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
        sus recordatorios, o para mantener sincronizados los que elijas.
      </p>
      <ul>
        <li>
          Para importar una vez no se guarda ningún permiso permanente: el token de acceso temporal
          (una hora como máximo) se guarda cifrado solo mientras se descargan los calendarios y se
          borra al terminar.
        </li>
        <li>
          Si activas la sincronización, Delyra guarda cifrado un token de actualización de solo
          lectura y el email de esa cuenta de Google, y cada 15 minutos consulta los cambios de los
          calendarios que elegiste. Lo borra en cuanto pulsas «Desconectar Google» (y revoca el
          permiso en Google) o si Google lo retira.
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
        dictado de tu navegador (en Chrome, el de Google; en Safari, el de Apple) o, en la app de
        Android, el reconocimiento de voz del móvil (en la mayoría, el de Google). Delyra no recibe
        ni guarda el audio: solo el texto que aparece en el campo, y únicamente si decides añadir el
        evento.
      </p>

      <h2>App de Android</h2>
      <p>
        La app guarda en el móvil tu sesión, cifrada con el almacén de claves de Android, para que
        no tengas que entrar cada vez, y una copia de lo último que has visto (agenda y tableros)
        para poder abrirlo sin conexión. Las dos se borran al cerrar sesión, y ninguna va en las
        copias de seguridad del móvil ni pasa a otro dispositivo. La app no tiene anuncios, ni
        analítica, ni rastreo de ningún tipo.
      </p>

      <h2>Dónde se guardan</h2>
      <p>
        En la infraestructura de Cloudflare (base de datos y almacenamiento en la Unión Europea),
        con copias de seguridad cifradas en reposo.
      </p>

      <h2>Cuánto tiempo</h2>
      <ul>
        <li>
          Tu cuenta y lo que creas (calendarios, eventos, tableros, tarjetas y adjuntos): mientras
          tengas la cuenta o hasta que lo borres. Si eliminas la cuenta, se borra todo al momento;
          solo queda en las copias del sistema hasta que caducan.
        </li>
        <li>
          Copias de seguridad del sistema: las diarias, 30 días; las semanales, 12 semanas; las
          mensuales, 1 año. Tus propias copias, las que elijas conservar en Ajustes.
        </li>
        <li>
          Sesiones caducadas o cerradas, intentos de inicio de sesión, enlaces para restablecer la
          contraseña e invitaciones sin usar: se borran 30 días después de caducar.
        </li>
        <li>Historial de seguridad de tu cuenta (accesos y cambios): 1 año.</li>
      </ul>

      <h2>Datos de Microsoft 365</h2>
      <p>
        Solo si lo activas en un tablero, Delyra lee tu calendario de Microsoft 365 con permiso de{" "}
        <strong>solo lectura</strong> (<code>Calendars.Read</code>) para convertir tus reuniones en
        tarjetas. De cada reunión toma únicamente el asunto, el horario, el lugar, el nombre de
        quien la organiza y el enlace de Teams; nunca el contenido ni la lista de asistentes.
      </p>
      <ul>
        <li>
          Guarda cifrados el permiso de acceso (que Microsoft renueva periódicamente) y el email de
          la cuenta conectada, y los borra al pulsar «Desconectar Microsoft 365».
        </li>
        <li>
          Las tarjetas creadas son parte de tu tablero: las ven las personas con las que lo
          compartes y se quedan aunque desconectes.
        </li>
      </ul>

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
        </a>
        , descargar una copia de todo desde Ajustes → Copias de seguridad y{" "}
        <Link to="/borrar-cuenta" className="underline">
          eliminar tu cuenta
        </Link>{" "}
        cuando quieras.
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
          Las importaciones y la sincronización con Google son a petición tuya y solo leen los
          calendarios de la cuenta con la que te conectas. Los calendarios sincronizados se editan
          en Google.
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
          eliminar tu cuenta cuando quieras, desde Ajustes.
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
