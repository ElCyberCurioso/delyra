import { OFFLINE_API_CACHE } from "../pwa-options";

/**
 * Datos guardados para usar la app sin conexión (F7-01). Se borran al cerrar sesión y cuando
 * entra otra cuenta en el mismo navegador, para que nadie vea los datos de otra persona.
 */

const PREVIOUS_ACCOUNT_KEY = "delyra.lastAccount";

export async function clearOfflineData(): Promise<void> {
  try {
    if (typeof caches !== "undefined") await caches.delete(OFFLINE_API_CACHE);
  } catch {
    // Sin Cache Storage (navegación privada, tests): no hay nada que borrar.
  }
}

/** Llamar con la sesión ya comprobada: si es otra cuenta que la última, se vacía la caché. */
export async function rememberUser(userId: string): Promise<void> {
  let previous: string | null;
  try {
    previous = localStorage.getItem(PREVIOUS_ACCOUNT_KEY);
    localStorage.setItem(PREVIOUS_ACCOUNT_KEY, userId);
  } catch {
    // Sin almacenamiento: no se puede comparar; mejor vaciar.
    previous = null;
  }
  if (previous !== userId) await clearOfflineData();
}

export function forgetUser(): void {
  try {
    localStorage.removeItem(PREVIOUS_ACCOUNT_KEY);
  } catch {
    // Nada que olvidar.
  }
}
