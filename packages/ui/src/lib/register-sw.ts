import { toast } from "sonner";
import { ui } from "../i18n";

/**
 * Registro del service worker (F7-01). Cada app pasa `registerSW` de `virtual:pwa-register`;
 * cuando hay una versión nueva se avisa y se actualiza al pulsar (no a mitad de una edición).
 */
export function setupServiceWorker(
  registerSW: (options: {
    onNeedRefresh?: () => void;
    onOfflineReady?: () => void;
  }) => (reloadPage?: boolean) => Promise<void>,
): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const update = registerSW({
    onNeedRefresh() {
      toast(ui().pwa.newVersion, {
        duration: Number.POSITIVE_INFINITY,
        action: { label: ui().pwa.update, onClick: () => void update(true) },
      });
    },
  });
}
