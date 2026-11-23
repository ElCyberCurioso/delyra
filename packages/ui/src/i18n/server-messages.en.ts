import type { ServerMessages } from "./server-messages";

/**
 * Traducción de los mensajes del servidor y de los esquemas compartidos (F7-06). La prueba
 * `server-messages.test.ts` comprueba que cada mensaje del código tiene aquí su versión.
 */

/** Piezas que el servidor mete dentro de otros mensajes (copias de seguridad). */
const PARTS: Readonly<Record<string, string>> = {
  calendarios: "calendars",
  eventos: "events",
  tableros: "boards",
  columnas: "columns",
  etiquetas: "labels",
  tarjetas: "cards",
  "elementos de checklist": "checklist items",
  comentarios: "comments",
  actividad: "activity",
  adjuntos: "attachments",
  "evento sin su calendario": "event without its calendar",
  "evento que termina antes de empezar": "event that ends before it starts",
  "excepción de serie incompleta": "incomplete series exception",
  "excepción sin su serie": "exception without its series",
  "alerta sin su evento": "alert without its event",
  "columna sin su tablero": "column without its board",
  "etiqueta sin su tablero": "label without its board",
  "tarjeta fuera de su tablero": "card outside its board",
  "etiqueta de otro tablero": "label from another board",
  "etiqueta repetida": "repeated label",
  "dato sin su tarjeta": "data without its card",
  "(raíz)": "(root)",
};
const part = (text: string) => PARTS[text] ?? text;

const exact: Record<string, string> = {
  ...PARTS,
  // Problem details genéricos (packages/shared/src/problem.ts).
  "Petición no válida": "Invalid request",
  "Autenticación requerida": "Authentication required",
  "Recurso no encontrado": "Not found",
  "Método no permitido": "Method not allowed",
  "Conflicto con el estado actual": "Conflict with the current state",
  "Petición demasiado grande": "Request too large",
  "Tipo de contenido no admitido": "Unsupported content type",
  "Datos no válidos": "Invalid data",
  "Servicio no disponible": "Service unavailable",
  "Demasiadas peticiones": "Too many requests",
  "Error interno": "Internal error",
  "Acceso denegado": "Access denied",
  // Esquemas compartidos.
  "Email no válido": "Invalid email",
  "Indica tu nombre": "Enter your name",
  "Enlace no válido": "Invalid link",
  "Código de 6 dígitos": "6-digit code",
  "Código de recuperación no válido": "Invalid recovery code",
  "Completa la verificación": "Complete the verification",
  "Escribe tu contraseña": "Type your password",
  "Escribe el código": "Type the code",
  "Escribe tu contraseña actual": "Type your current password",
  "Escribe un comentario": "Write a comment",
  "Color no válido": "Invalid colour",
  "Ponle un nombre": "Give it a name",
  "Ponle un título": "Give it a title",
  "No hay nada que cambiar": "There's nothing to change",
  "Regla de repetición no válida": "Invalid repeat rule",
  "Indica si es de día completo": "Say whether it's all day",
  "Un evento no puede durar más de un año": "An event can't last more than a year",
  "Hora no válida (HH:MM)": "Invalid time (HH:MM)",
  "Indica el inicio y el fin de las horas de silencio": "Enter the start and end of quiet hours",
  "Identificador no válido": "Invalid identifier",
  "Zona horaria no válida": "Invalid time zone",
  "Pega la «Dirección secreta en formato iCal» de Google Calendar (https://calendar.google.com/calendar/ical/…/basic.ics)":
    "Paste Google Calendar's “Secret address in iCal format” (https://calendar.google.com/calendar/ical/…/basic.ics)",
  // Acceso y cuenta.
  "Email o contraseña incorrectos": "Wrong email or password",
  "La invitación no es válida o ha caducado": "The invitation isn't valid or has expired",
  "Demasiados códigos incorrectos. Vuelve a iniciar sesión.":
    "Too many wrong codes. Sign in again.",
  "El código no es válido": "The code isn't valid",
  // Llaves de acceso (F7-09).
  "Ya tienes el máximo de llaves de acceso": "You already have the maximum number of passkeys",
  "Esa llave de acceso ya está registrada": "That passkey is already registered",
  "No se ha podido registrar la llave de acceso. Vuelve a intentarlo.":
    "The passkey couldn't be registered. Please try again.",
  "Llave de acceso no encontrada": "Passkey not found",
  "Tu cuenta no tiene llaves de acceso": "Your account has no passkeys",
  "La llave de acceso no es válida": "The passkey isn't valid",
  "Ponle un nombre a la llave": "Give the passkey a name",
  "El código no es válido. Revisa la hora del móvil.":
    "The code isn't valid. Check the time on your phone.",
  "El enlace no es válido o ha caducado": "The link isn't valid or has expired",
  "Demasiados intentos. Vuelve a intentarlo más tarde.": "Too many attempts. Try again later.",
  "No se ha superado la verificación antibots": "The anti-bot check failed",
  "La verificación antibots no está configurada": "The anti-bot check isn't set up",
  "Esta contraseña aparece en filtraciones conocidas. Elige otra.":
    "This password appears in known data breaches. Choose another one.",
  "La contraseña no puede contener tu email": "The password can't contain your email",
  "La contraseña o el código no son correctos": "The password or the code is wrong",
  "Debe ser distinta de la actual": "It must be different from the current one",
  "La cuenta no tiene TOTP activo": "The account doesn't have TOTP turned on",
  "El código no es correcto o han pasado más de 10 minutos. Vuelve a empezar.":
    "The code is wrong or more than 10 minutes have passed. Start again.",
  "Origen no permitido": "Origin not allowed",
  "Se esperaba un WebSocket": "A WebSocket was expected",
  // Administración.
  "Ya existe una cuenta con ese email": "There's already an account with that email",
  "No puedes desactivar tu propia cuenta": "You can't disable your own account",
  "Tu propio 2FA se cambia en Ajustes → Seguridad": "Change your own 2FA in Settings → Security",
  "Ya hay un backup en marcha": "A backup is already running",
  "Email Service no está configurado": "Email Service isn't set up",
  "Exportación de D1 no configurada (cuenta, base de datos o token)":
    "D1 export isn't set up (account, database or token)",
  "La API de D1 no devolvió `at_bookmark`": "The D1 API didn't return `at_bookmark`",
  "Respuesta de la API de D1 con formato inesperado": "Unexpected response format from the D1 API",
  "La exportación de D1 aún no está lista": "The D1 export isn't ready yet",
  "No se encuentra el volcado diario para copiarlo": "The daily dump to copy can't be found",
  "Fecha de backup no válida": "Invalid backup date",
  "sin detalle": "no detail",
  // Calendario y eventos.
  "Calendario no encontrado": "Calendar not found",
  "Necesitas al menos un calendario": "You need at least one calendar",
  "Lista de calendarios no válida": "Invalid list of calendars",
  "El fin debe ser posterior al inicio": "The end must be after the start",
  "Fecha no válida": "Invalid date",
  "Fecha y hora no válidas": "Invalid date and time",
  "El año de nacimiento no puede ser posterior a la fecha":
    "The year of birth can't be after the date",
  "Ese calendario es una suscripción de solo lectura": "That calendar is a read-only subscription",
  "Este evento es de una suscripción de solo lectura y no se puede cambiar":
    "This event comes from a read-only subscription and can't be changed",
  "Indica el inicio y el fin al cambiar el tipo de horario":
    "Enter the start and end when switching between all-day and timed",
  "Indica qué ocurrencia": "Say which occurrence",
  "Esa ocurrencia no existe": "That occurrence doesn't exist",
  "La repetición se cambia para toda la serie o desde una ocurrencia":
    "The repeat is changed for the whole series or from an occurrence onwards",
  "La regla de repetición no es válida": "The repeat rule isn't valid",
  "Solo se admite repetición diaria, semanal, mensual o anual":
    "Only daily, weekly, monthly or yearly repeats are supported",
  "Intervalo no válido": "Invalid interval",
  "Usa COUNT o UNTIL, no los dos": "Use COUNT or UNTIL, not both",
  "La serie no tiene regla": "The series has no rule",
  Cumpleaños: "Birthdays",
  "(Sin título)": "(No title)",
  // Kanban y tableros compartidos.
  "Columna no válida": "Invalid column",
  "Etiqueta no válida": "Invalid label",
  "Demasiadas etiquetas en este tablero": "Too many labels on this board",
  "La checklist está llena": "The checklist is full",
  "Esta tarjeta ya tiene demasiados adjuntos": "This card already has too many attachments",
  "El fichero supera los 10 MB": "The file is larger than 10 MB",
  "Ese tipo de fichero no está permitido": "That type of file isn't allowed",
  "Rango no válido": "Invalid range",
  "Has llegado al máximo de 100 tableros": "You've reached the maximum of 100 boards",
  "Tienes este tablero en modo de solo lectura": "You have this board in read-only mode",
  "Solo puede hacerlo quien creó el tablero": "Only the person who created the board can do that",
  "Solo puedes editar tus comentarios": "You can only edit your own comments",
  "Solo puedes borrar tus comentarios": "You can only delete your own comments",
  "Solo quien creó el tablero elige los avisos":
    "Only the person who created the board chooses the alerts",
  "Esa persona ya tiene acceso al tablero": "That person already has access to the board",
  "Ya no tienes acceso a este tablero": "You no longer have access to this board",
  // Telegram.
  "Telegram aún no está configurado": "Telegram isn't set up yet",
  "Primero vincula tu cuenta de Telegram": "Link your Telegram account first",
  "Sin conexión con Telegram": "Can't reach Telegram",
  "Respuesta no válida de Telegram": "Invalid response from Telegram",
  // Importación, suscripciones y Google.
  "Has hecho demasiadas importaciones hoy. Prueba mañana.":
    "You've made too many imports today. Try tomorrow.",
  "Ya tienes una importación en marcha. Espera a que termine.":
    "You already have an import running. Wait for it to finish.",
  "No se ha podido empezar a leer el calendario. Vuelve a intentarlo.":
    "Couldn't start reading the calendar. Please try again.",
  "El fichero supera los 25 MB": "The file is larger than 25 MB",
  "Sube el .zip que exporta Google Calendar o un fichero .ics":
    "Upload the .zip that Google Calendar exports or an .ics file",
  "La vista previa ha caducado. Vuelve a subir el fichero.":
    "The preview has expired. Upload the file again.",
  "Esta importación ya no se puede empezar": "This import can no longer be started",
  "Esta importación ya se ha empezado": "This import has already started",
  "Elige al menos un calendario para importar": "Choose at least one calendar to import",
  "No se puede importar en una suscripción de solo lectura":
    "You can't import into a read-only subscription",
  "Se superaría el máximo de 50 calendarios": "It would go over the maximum of 50 calendars",
  "No se ha podido empezar la importación. Reinténtalo.": "Couldn't start the import. Try again.",
  "Espera a que termine la importación": "Wait for the import to finish",
  "La importación se interrumpió. Vuelve a intentarlo.": "The import was interrupted. Try again.",
  "No se ha podido completar. Vuelve a intentarlo más tarde.":
    "It couldn't be completed. Try again later.",
  "El fichero ya no está disponible. Súbelo de nuevo.":
    "The file is no longer available. Upload it again.",
  "Los datos de la importación ya no están disponibles": "The import data is no longer available",
  "El calendario es demasiado grande": "The calendar is too large",
  "Uno de los calendarios de destino ya no existe":
    "One of the destination calendars no longer exists",
  "Destino no válido": "Invalid destination",
  "Has llegado al máximo de 50 calendarios": "You've reached the maximum of 50 calendars",
  "La importación no existe": "The import doesn't exist",
  "La importación no está lista": "The import isn't ready",
  "El zip está dañado": "The zip is damaged",
  "El zip está dañado o no se puede leer": "The zip is damaged or can't be read",
  "El zip no contiene ningún calendario (.ics)": "The zip doesn't contain any calendar (.ics)",
  "El contenido del zip es demasiado grande": "The zip's contents are too large",
  "Un calendario del zip es demasiado grande": "A calendar in the zip is too large",
  "Algún evento de Google no tenía fecha y se ha descartado":
    "Some Google event had no date and was skipped",
  "Algún evento duraba más de un año y se ha acortado":
    "Some event lasted more than a year and was shortened",
  "Había eventos repetidos con el mismo UID: se conserva el último":
    "There were repeated events with the same UID: the last one is kept",
  "Se han descartado alertas fuera del rango admitido (hasta 4 semanas antes)":
    "Alerts outside the supported range (up to 4 weeks before) were skipped",
  "Las fechas sueltas de repetición (RDATE) no se admiten y se han ignorado":
    "Extra repeat dates (RDATE) aren't supported and were ignored",
  "Calendario de Google": "Google calendar",
  "La conexión con Google no está configurada": "The connection with Google isn't set up",
  "La autorización de Google ha caducado. Vuelve a conectar.":
    "The Google authorisation has expired. Connect again.",
  "No se concedió acceso de lectura al calendario": "Read access to the calendar wasn't granted",
  "Respuesta de Google sin token de acceso": "Google's response had no access token",
  "La dirección de la suscripción no es válida": "The subscription address isn't valid",
  "No se ha podido conectar con Google Calendar": "Couldn't connect with Google Calendar",
  "La dirección redirige a otro sitio y no se sigue":
    "The address redirects somewhere else and isn't followed",
  "Google no reconoce la dirección: puede que la hayas restablecido. Pega la nueva.":
    "Google doesn't recognise the address: you may have reset it. Paste the new one.",
  "La dirección no devuelve un calendario (.ics)": "The address doesn't return a calendar (.ics)",
  "No se ha podido sincronizar. Se volverá a intentar más tarde.":
    "Couldn't sync. It will be tried again later.",
  "Se acaba de sincronizar. Espera unos minutos.": "It was just synced. Wait a few minutes.",
  Suscripción: "Subscription",
  "Suscripción de Google": "Google subscription",
  // Copias de seguridad y restauraciones.
  "Ya se está haciendo una copia. Espera a que termine.":
    "A backup is already being made. Wait for it to finish.",
  "Ya hay una restauración en marcha.": "A restore is already running.",
  "Has hecho muchas copias hoy. Prueba mañana.": "You've made many backups today. Try tomorrow.",
  "No se ha podido empezar la copia": "Couldn't start the backup",
  "No se ha podido empezar la copia. Reinténtalo.": "Couldn't start the backup. Try again.",
  "Espera a que termine": "Wait for it to finish",
  "Has hecho muchas restauraciones hoy. Prueba mañana.":
    "You've made many restores today. Try tomorrow.",
  "No se ha podido empezar a leer la copia. Reinténtalo.":
    "Couldn't start reading the backup. Try again.",
  "Falta el tamaño del fichero": "The file size is missing",
  "La copia supera los 200 MB": "The backup is larger than 200 MB",
  "Nombre de fichero no válido": "Invalid file name",
  "Falta el fichero": "The file is missing",
  "Sube una copia de Delyra (.zip o .json)": "Upload a Delyra backup (.zip or .json)",
  "El fichero no coincide con su tamaño": "The file doesn't match its size",
  "Copia no encontrada": "Backup not found",
  "La vista previa ha caducado. Vuelve a empezar.": "The preview has expired. Start again.",
  "Esta restauración ya no se puede empezar": "This restore can no longer be started",
  "Esta restauración ya se ha empezado": "This restore has already started",
  "No se ha podido empezar. Reinténtalo.": "Couldn't start. Try again.",
  "Esta restauración no se puede deshacer": "This restore can't be undone",
  "La copia previa ya no está disponible": "The earlier backup is no longer available",
  "Copia no válida": "Invalid backup",
  "No se ha podido generar la copia": "Couldn't generate the backup",
  "La copia no existe": "The backup doesn't exist",
  "La restauración no existe": "The restore doesn't exist",
  "La restauración no está lista": "The restore isn't ready",
  "La copia se interrumpió": "The backup was interrupted",
  "No se pudo registrar la copia": "Couldn't record the backup",
  "La restauración se interrumpió.": "The restore was interrupted.",
  "Los datos de la restauración ya no están disponibles": "The restore data is no longer available",
  "La copia ya no está disponible": "The backup is no longer available",
  "La copia es demasiado grande": "The backup is too large",
  "El zip no contiene backup.json": "The zip doesn't contain backup.json",
  "El fichero no es una copia de Delyra": "The file isn't a Delyra backup",
  "El fichero no es una copia de Delyra (JSON no válido)":
    "The file isn't a Delyra backup (invalid JSON)",
  "La copia está dañada o se ha modificado (el checksum no coincide)":
    "The backup is damaged or has been modified (the checksum doesn't match)",
  // Creación de registros (errores internos que pueden llegar a verse).
  "No se pudo crear el calendario": "Couldn't create the calendar",
  "No se pudo crear el evento": "Couldn't create the event",
  "No se pudo crear el usuario": "Couldn't create the user",
  "No se pudo crear la importación": "Couldn't create the import",
  "No se pudo crear la invitación": "Couldn't create the invitation",
  "No se pudo crear la restauración": "Couldn't create the restore",
  "No se pudo crear la sesión": "Couldn't create the session",
  "No se pudo crear la suscripción": "Couldn't create the subscription",
  "Informe CSP no reconocido": "Unrecognised CSP report",
  "Base32 no válido": "Invalid Base32",
};

const patterns: ServerMessages["patterns"] = [
  [/^Máximo (\d+) caracteres$/, (n = "") => `At most ${n} characters`],
  [/^Mínimo (\d+) caracteres$/, (n = "") => `At least ${n} characters`],
  [/^Como máximo (\d+) días$/, (n = "") => `At most ${n} days`],
  [/^Como máximo (\d+) tarjetas por tablero$/, (n = "") => `At most ${n} cards per board`],
  [/^Como máximo (\d+) columnas$/, (n = "") => `At most ${n} columns`],
  [/^Como máximo (\d+) repeticiones$/, (n = "") => `At most ${n} repetitions`],
  [
    /^Has llegado al máximo de (\d+) calendarios$/,
    (n = "") => `You've reached the maximum of ${n} calendars`,
  ],
  [
    /^Tu cuenta tiene más de (\d+) calendarios$/,
    (n = "") => `Your account has more than ${n} calendars`,
  ],
  [/^El zip tiene más de (\d+) calendarios$/, (n = "") => `The zip has more than ${n} calendars`],
  [
    /^Demasiados eventos; el máximo por importación es (\d+)$/,
    (n = "") => `Too many events; the maximum per import is ${n}`,
  ],
  [/^Se han descartado (\d+) eventos$/, (n = "") => `${n} events were skipped`],
  [
    /^Solo se conservan (\d+) alertas por evento$/,
    (n = "") => `Only ${n} alerts per event are kept`,
  ],
  [
    /^Un tablero se puede compartir con (\d+) personas como mucho$/,
    (n = "") => `A board can be shared with at most ${n} people`,
  ],
  [
    /^(\d+) adjuntos faltan o no coinciden con la copia y no se restaurarán$/,
    (n = "") => `${n} attachments are missing or don't match the backup and won't be restored`,
  ],
  [/^«(.+)» es demasiado grande$/s, (name = "") => `“${name}” is too large`],
  [/^Fecha no válida: (.+)$/s, (date = "") => `Invalid date: ${date}`],
  [/^Propiedad no admitida: (.+)$/s, (key = "") => `Unsupported property: ${key}`],
  [/^Google Calendar respondió (\d+)$/, (n = "") => `Google Calendar responded ${n}`],
  [/^Google rechazó el código \((\d+)\)$/, (n = "") => `Google rejected the code (${n})`],
  [/^Tiempo de espera agotado \((\d+) ms\)$/, (n = "") => `Timed out (${n} ms)`],
  [
    /^La copia es de una versión más nueva del formato \(v(\d+)\) y no se puede leer$/,
    (n = "") => `The backup is from a newer format version (v${n}) and can't be read`,
  ],
  [
    /^La copia tiene (.+) con el mismo id$/s,
    (what = "") => `The backup has ${part(what)} with the same id`,
  ],
  [
    /^La copia tiene referencias rotas \((.+)\)$/s,
    (what = "") => `The backup has broken references (${part(what)})`,
  ],
  [
    /^La copia tiene datos no válidos \((.+)\)$/s,
    (path = "") => `The backup has invalid data (${part(path)})`,
  ],
  [/^La copia tiene datos no válidos$/, () => "The backup has invalid data"],
  [/^Descarga del volcado fallida \(HTTP (\d+)\)$/, (n = "") => `Dump download failed (HTTP ${n})`],
  [/^La API de D1 devolvió un error: (.+)$/s, (e = "") => `The D1 API returned an error: ${e}`],
  [
    /^La API de D1 rechazó la exportación \(HTTP (\d+)\)$/,
    (n = "") => `The D1 API rejected the export (HTTP ${n})`,
  ],
  [/^La API de D1 respondió HTTP (\d+)$/, (n = "") => `The D1 API responded HTTP ${n}`],
  [
    /^La exportación de D1 falló: (.+)$/s,
    (e = "") => `The D1 export failed: ${e === "sin detalle" ? "no detail" : e}`,
  ],
];

const en: ServerMessages = { exact, patterns };

export default en;
