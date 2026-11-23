// Turnstile para la app de Android (F8-02). La app inyecta `window.delyraTurnstile` con un
// WebMessageListener limitado al origen de Delyra; por él salen los mensajes y entra «reset».
//
// Mensajes a la app: `token:<token>`, `expired`, `error:<código>`.
"use strict";

(() => {
  const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  /** Clave de prueba de Cloudflare: solo en local, si la API no da una (como la SPA). */
  const TEST_SITE_KEY = "1x00000000000000000000AA";

  const bridge = window.delyraTurnstile;
  const send = (message) => {
    if (bridge) bridge.postMessage(message);
  };

  const params = new URLSearchParams(window.location.search);
  const theme = params.get("theme") === "dark" ? "dark" : "light";
  const language = params.get("lang") === "en" ? "en" : "es";
  const action = /^[a-z-]{1,32}$/.test(params.get("action") ?? "") ? params.get("action") : "login";
  let widgetId = null;

  const loadScript = () =>
    new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SCRIPT_URL;
      script.async = true;
      script.onload = () =>
        window.turnstile ? resolve(window.turnstile) : reject(new Error("api"));
      script.onerror = () => reject(new Error("script"));
      document.head.append(script);
    });

  const siteKey = () =>
    fetch("/api/auth/config", { credentials: "omit", headers: { Accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("config"))))
      .then((config) => {
        if (config.turnstileSiteKey) return config.turnstileSiteKey;
        if (window.location.hostname === "localhost") return TEST_SITE_KEY;
        throw new Error("config");
      });

  if (bridge) {
    bridge.onmessage = (event) => {
      if (event.data === "reset" && widgetId !== null && window.turnstile) {
        window.turnstile.reset(widgetId);
      }
    };
  }

  Promise.all([siteKey(), loadScript()])
    .then(([sitekey, turnstile]) => {
      widgetId = turnstile.render("#widget", {
        sitekey,
        action,
        theme,
        language,
        "refresh-expired": "auto",
        callback: (token) => send(`token:${token}`),
        "expired-callback": () => send("expired"),
        "error-callback": (code) => {
          send(`error:${String(code ?? "unknown")}`);
          return true;
        },
      });
    })
    .catch((error) => send(`error:${error instanceof Error ? error.message : "unknown"}`));
})();
