/** Clave de `localStorage` con la preferencia de tema. */
export const THEME_STORAGE_KEY = "delyra-theme";

/**
 * Se sirve como `/theme-init.js` y se carga de forma síncrona en el `<head>` para aplicar
 * el tema antes del primer pintado (sin parpadeo). Va en un fichero aparte, no en línea,
 * para que la CSP pueda prohibir los scripts inline.
 */
export const THEME_INIT_SCRIPT = `(function () {
  try {
    var stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    var dark =
      stored === "dark" ||
      (stored !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  } catch (e) {}
})();
`;
