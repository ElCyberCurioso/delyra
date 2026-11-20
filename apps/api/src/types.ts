import type { Logger } from "./lib/logger";

export interface AppVariables {
  requestId: string;
  logger: Logger;
}

export interface AppEnv {
  Bindings: Env;
  Variables: AppVariables;
}
