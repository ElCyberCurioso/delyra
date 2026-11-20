import type { Logger } from "./lib/logger";
import type { RequestMeta } from "./lib/request-meta";
import type { ResolvedSession } from "./services/sessions";

export interface AppVariables {
  requestId: string;
  logger: Logger;
  meta: RequestMeta;
  /** Sesión de la cookie, si es válida (en cualquier estado). */
  auth: ResolvedSession | null;
}

export interface AppEnv {
  Bindings: Env;
  Variables: AppVariables;
}
