import { useEffect, useRef } from "react";
import { getLocale } from "../i18n";

interface TurnstileApi {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error("Turnstile no se ha cargado"));
    };
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("No se pudo cargar Turnstile"));
    };
    document.head.append(script);
  });
  return scriptPromise;
}

export interface TurnstileProps {
  siteKey: string;
  /** Acción que se verá en las analíticas de Turnstile (login, register…). */
  action: string;
  /** Recibe el token, o `null` cuando caduca o falla. */
  onToken: (token: string | null) => void;
  /** Cambiar este valor pide un token nuevo (cada token sirve una sola vez). */
  resetKey?: number;
}

/** Comprobación anti-bots de Cloudflare. Sin cookies de terceros ni rastreo. */
export function Turnstile({ siteKey, action, onToken, resetKey = 0 }: TurnstileProps) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);

  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        if (cancelled || !container.current) return;
        widgetId.current = api.render(container.current, {
          sitekey: siteKey,
          action,
          theme: "auto",
          language: getLocale(),
          callback: (token: string) => onTokenRef.current(token),
          "expired-callback": () => onTokenRef.current(null),
          "error-callback": () => onTokenRef.current(null),
        });
      })
      .catch(() => onTokenRef.current(null));
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey, action]);

  useEffect(() => {
    if (resetKey === 0 || !widgetId.current || !window.turnstile) return;
    onTokenRef.current(null);
    window.turnstile.reset(widgetId.current);
  }, [resetKey]);

  return <div ref={container} className="min-h-[65px]" />;
}
