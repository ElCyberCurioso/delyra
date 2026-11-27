/**
 * Enrutado de los Workers de las SPA (`delyra-calendar` y `delyra-work`): `/api/*` va al
 * Worker `api` por Service Binding, conservando la URL, el método, las cabeceras y la
 * cookie; todo lo demás lo sirve Static Assets (con fallback a `index.html`).
 */
interface FetcherLike {
  fetch(request: Request): Promise<Response>;
}

export interface FrontendBindings {
  API: FetcherLike;
  ASSETS: FetcherLike;
}

export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export function routeFrontendRequest(request: Request, env: FrontendBindings): Promise<Response> {
  const { pathname } = new URL(request.url);
  return isApiPath(pathname) ? env.API.fetch(request) : env.ASSETS.fetch(request);
}
