/**
 * Configuración PWA común (F7-01) para `vite-plugin-pwa` (estrategia `generateSW`):
 *
 * - Precarga la aplicación (HTML, JS, CSS, iconos) para que abra sin conexión.
 * - Lecturas de la API que hacen falta para ver la agenda o los tableros (también el detalle de un
 *   tablero, para abrirlo): primero la red y, si no hay (o tarda más de 4 s), la última respuesta
 *   guardada. Nada más se guarda: ni adjuntos ni copias de seguridad ni nada que no sea un GET de
 *   esas rutas. La app de Android guarda lo mismo (`OfflineCache.kt`).
 * - La caché de la API se borra al cerrar sesión o al entrar con otra cuenta
 *   (`clearOfflineData`), para que nadie vea sin conexión los datos de otra persona.
 * - Las navegaciones a `/api/*` (callback de Google, descargas) nunca las sirve el service worker.
 */

export const OFFLINE_API_CACHE = "delyra-api";

interface Manifest {
  name: string;
  short_name: string;
  description: string;
}

const MANIFESTS: Record<"calendar" | "work", Manifest> = {
  calendar: {
    name: "Delyra · Calendario",
    short_name: "Delyra",
    description: "Tu calendario personal y de trabajo, con alertas por Telegram.",
  },
  work: {
    name: "Delyra · Trabajo",
    short_name: "Trabajo",
    description: "Tableros kanban con fechas límite y alertas.",
  },
};

export function pwaOptions(app: "calendar" | "work") {
  return {
    registerType: "prompt" as const,
    // Se registra desde el código (`virtual:pwa-register`): sin scripts inline (CSP).
    injectRegister: null,
    includeAssets: ["favicon.svg", "apple-touch-icon.png"],
    manifest: {
      ...MANIFESTS[app],
      lang: "es",
      start_url: "/",
      scope: "/",
      display: "standalone" as const,
      theme_color: "#007145",
      background_color: "#faf9f4",
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    workbox: {
      globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest}"],
      navigateFallback: "/index.html",
      // `/mobile/*`: la página de Turnstile de la app de Android se sirve siempre tal cual.
      navigateFallbackDenylist: [/^\/api\//, /^\/mobile\//],
      cleanupOutdatedCaches: true,
      runtimeCaching: [
        {
          // workbox-build copia esta función tal cual al service worker: sin variables de fuera.
          urlPattern: ({ url, request }: { url: URL; request: Request }) =>
            request.method === "GET" &&
            url.origin === self.location.origin &&
            /^\/api\/(auth\/me|calendars|events|cards\/due|holidays|boards|boards\/[^/]+|cards\/[^/]+)$/.test(
              url.pathname,
            ),
          handler: "NetworkFirst" as const,
          options: {
            cacheName: OFFLINE_API_CACHE,
            networkTimeoutSeconds: 4,
            expiration: { maxEntries: 300, maxAgeSeconds: 14 * 86_400 },
            cacheableResponse: { statuses: [200] },
          },
        },
      ],
    },
  };
}
