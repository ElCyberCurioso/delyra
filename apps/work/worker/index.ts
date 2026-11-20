import { routeFrontendRequest } from "@delyra/shared";

/**
 * Solo se ejecuta para `/api/*` (`assets.run_worker_first`); el resto lo sirve Static Assets
 * directamente, con las cabeceras de `_headers`.
 */
export default {
  fetch: (request, env) => routeFrontendRequest(request, env),
} satisfies ExportedHandler<Env>;
