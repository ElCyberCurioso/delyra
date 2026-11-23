import { defineMessages } from "@delyra/ui";

const count = (n: number, one: string, many: string, locale: string) =>
  `${n.toLocaleString(locale)} ${n === 1 ? one : many}`;

/** Textos del asistente de importación (F7-06). Traducción en `messages.en.ts`. */
const es = {
  google: {
    denied: "Has cancelado la conexión con Google. No se ha importado nada.",
    state:
      "La respuesta de Google no era válida o había caducado. Vuelve a pulsar «Conectar con Google».",
    busy: "Ya tienes una importación en marcha. Espera a que termine.",
    error: "No se ha podido conectar con Google. Vuelve a intentarlo.",
  },
  counts: {
    events: (n: number) => count(n, "evento", "eventos", "es-ES"),
    series: (n: number) => count(n, "serie", "series", "es-ES"),
    birthdays: (n: number) => count(n, "cumpleaños", "cumpleaños", "es-ES"),
    withReminders: (n: number) => count(n, "con alerta", "con alertas", "es-ES"),
    warnings: (n: number) => count(n, "aviso", "avisos", "es-ES"),
    created: (n: number) => count(n, "nuevo", "nuevos", "es-ES"),
    updated: (n: number) => count(n, "actualizado", "actualizados", "es-ES"),
    unchanged: (n: number) => count(n, "sin cambios", "sin cambios", "es-ES"),
  },
  file: {
    missing: "Elige el .zip o el .ics que has exportado.",
    title: "Desde un archivo exportado",
    open: "En Google Calendar, abre",
    path: "Configuración → Importar y exportar → Exportar",
    after: ". Descargarás un .zip con un .ics por calendario. También vale un .ics suelto.",
    label: "Archivo (.zip o .ics, hasta 25 MB)",
    upload: "Subir y ver qué contiene",
  },
  account: {
    title: "Desde tu cuenta de Google",
    description:
      "Delyra lee tus calendarios, colores, eventos y recordatorios una sola vez, con permiso de solo lectura. No guarda ningún acceso permanente a tu cuenta.",
    connect: "Conectar con Google",
    unavailable:
      "La conexión directa con Google aún no está disponible. Usa la exportación en archivo.",
    see: "Consulta la",
    privacy: "política de privacidad",
    and: "y las",
    terms: "condiciones",
  },
  subscriptions: {
    updated: (when: string) => ` · actualizado ${when}`,
    sync: "Sincronizar",
    remove: (name: string) => `Quitar la suscripción ${name}`,
    confirmRemove: (name: string) =>
      `¿Quitar «${name}»? Se borrará su calendario en Delyra (no el de Google).`,
    subscribed: (name: string) => `Suscrito a «${name}»`,
    title: "Suscripción a la dirección iCal secreta",
    intro: "Mantiene un calendario de solo lectura al día (cada hora). En Google Calendar:",
    path: "ajustes del calendario → Integrar el calendario → Dirección secreta en formato iCal",
    password: ". Trátala como una contraseña.",
    address: "Dirección secreta en formato iCal",
    subscribe: "Suscribirse",
  },
  recent: {
    title: "Importaciones recientes",
    status: {
      analyzing: "Leyendo…",
      ready: "Pendiente de elegir calendarios",
      importing: "Importando…",
      succeeded: "Importada",
      failed: "Ha fallado",
      expired: "Caducada",
    },
    google: "Cuenta de Google",
    file: "Archivo",
  },
  preview: {
    destination: (name: string) => `Destino de «${name}»`,
    newCalendar: "Un calendario nuevo",
    addTo: (name: string) => `Añadir a «${name}»`,
    skip: "No importar",
    newName: "Nombre del calendario nuevo",
    chooseOne: "Elige al menos un calendario para importar.",
    nameNew: "Ponle nombre a los calendarios nuevos.",
    loading: "Cargando…",
    intro:
      "Elige dónde va cada calendario. Si repites la importación, los eventos que ya estaban se reconocen y no se duplican.",
    reminders: "Convertir los recordatorios de Google en alertas de Telegram",
    import: "Importar",
    discard: "Descartar",
    aboutContent: "sobre el contenido",
  },
  progress: {
    label: "Progreso de la importación",
    of: (done: number, total: string) => `${done.toLocaleString("es-ES")} de ${total}`,
  },
  report: {
    done: "Importación terminada",
    created: "Nuevos",
    updated: "Actualizados",
    unchanged: "Ya estaban",
    skipped: "Descartados",
  },
  wizard: {
    google: "Importar tu cuenta de Google",
    file: (name: string) => `Importar ${name}`,
    theFile: "el archivo",
    downloading: "Descargando tus calendarios de Google…",
    reading: "Leyendo el archivo…",
    importing: "Importando eventos…",
    expired: "Esta vista previa ha caducado. Vuelve a subir el archivo o a conectar con Google.",
    failed: "La importación ha fallado.",
    view: "Ver el calendario",
    another: "Importar otra cosa",
  },
  page: {
    title: "Importar desde Google Calendar",
    intro: "Trae tus calendarios, eventos, repeticiones, colores y recordatorios.",
  },
};

export type ImportMessages = typeof es;

export const importMessages = await defineMessages(es, () => import("./messages.en"));
