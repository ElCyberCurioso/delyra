import { defineMessages } from "@delyra/ui";

/** Textos de acceso, registro, 2FA y recuperación (F7-06). Traducción en `messages.en.ts`. */
const es = {
  notFound: {
    title: "Página no encontrada",
    description: "La dirección no existe o ha cambiado.",
    home: "Ir al inicio",
  },
  common: {
    email: "Email",
    password: "Contraseña",
    repeatPassword: "Repite la contraseña",
    continue: "Continuar",
    checking: "Comprobando…",
    retry: "Reintentar",
    sixDigits: "Introduce los 6 dígitos que muestra tu app.",
    passwordsDontMatch: "Las contraseñas no coinciden",
    completeTurnstile: "Completa la verificación anti-bots.",
    turnstileMissing:
      "La verificación anti-bots no está configurada en este entorno. Avisa al administrador.",
    backToLogin: "Volver a iniciar sesión",
    signIn: "Iniciar sesión",
  },
  login: {
    title: "Iniciar sesión",
    description: "Accede a tu calendario y a tus tableros.",
    forgot: "¿Has olvidado la contraseña?",
  },
  verify: {
    expiredTitle: "Sesión caducada",
    expiredDescription: "Vuelve a introducir tu email y contraseña.",
    title: "Verificación en dos pasos",
    recoveryDescription:
      "Escribe uno de los códigos de recuperación que guardaste. Cada código sirve una vez.",
    totpDescription: "Abre tu app autenticadora y escribe el código de 6 dígitos de Delyra.",
    recoveryCode: "Código de recuperación",
    code: "Código",
    recoveryIncomplete: "Introduce un código de recuperación completo (xxxxx-xxxxx).",
    remainingCodes: (n: number) =>
      `Te quedan ${String(n)} códigos de recuperación. Genera otros nuevos desde Ajustes si se agotan.`,
    verifying: "Verificando…",
    verify: "Verificar",
    useApp: "Usar la app autenticadora",
    useRecovery: "No tengo el móvil: usar un código de recuperación",
  },
  totp: {
    qrAlt: "Código QR para añadir Delyra a tu app autenticadora",
    manual: "¿No puedes escanearlo? Introduce la clave a mano",
    fileTitle: "Delyra · códigos de recuperación",
    fileGenerated: (when: string) => `Generados: ${when}`,
    fileOnce: "Cada código sirve una sola vez para entrar si pierdes el móvil.",
    fileStore: "Guárdalos en tu gestor de contraseñas o en un lugar seguro.",
    fileName: "delyra-codigos-recuperacion.txt",
    codesLabel: "Códigos de recuperación",
    copied: "Códigos copiados",
    copyFailed: "No se pudieron copiar",
    copy: "Copiar",
    download: "Descargar",
    saved: "He guardado los códigos en un lugar seguro.",
    saveTitle: "Guarda tus códigos de recuperación",
    saveDescription:
      "Si pierdes el móvil, cada uno de estos códigos te deja entrar una vez. No volverás a verlos.",
    setupFailed: "No se pudo preparar la verificación",
    setupTitle: "Activa la verificación en dos pasos",
    setupDescription:
      "Es obligatoria. Escanea el código con una app autenticadora (Google Authenticator, 1Password, Bitwarden, Aegis…).",
    codeLabel: "Código de 6 dígitos",
    activate: "Activar",
  },
  register: {
    invalidTitle: "Invitación no válida",
    invalidDescription:
      "El enlace ha caducado, ya se usó o está incompleto. Pide al administrador una invitación nueva.",
    title: "Crea tu cuenta",
    invitedAs: "Te han invitado como",
    afterwards: "Después configurarás la verificación en dos pasos.",
    name: "Nombre",
    passwordHint: (min: number) =>
      `Mínimo ${String(min)} caracteres. Una frase larga es más fácil de recordar y más segura.`,
    creating: "Creando cuenta…",
    create: "Crear cuenta",
  },
  forgot: {
    sentTitle: "Revisa tu correo",
    sentDescription:
      "Si hay una cuenta con ese email, te hemos enviado un enlace para elegir una contraseña nueva. Caduca en 30 minutos.",
    title: "Recuperar la contraseña",
    description:
      "Te enviaremos un enlace para elegir otra. Tu verificación en dos pasos no cambia.",
    sending: "Enviando…",
    send: "Enviar enlace",
  },
  reset: {
    changed: "Contraseña cambiada. Inicia sesión con la nueva.",
    invalidTitle: "Enlace no válido",
    invalidDescription:
      "El enlace está incompleto. Ábrelo directamente desde el correo o pide otro.",
    requestAnother: "Pedir otro enlace",
    title: "Elige una contraseña nueva",
    description: "Se cerrarán todas tus sesiones abiertas.",
    newPassword: "Contraseña nueva",
    minLength: (min: number) => `Mínimo ${String(min)} caracteres.`,
    saving: "Guardando…",
    change: "Cambiar contraseña",
  },
};

export type AuthMessages = typeof es;

export const authMessages = await defineMessages(es, () => import("./messages.en"));
