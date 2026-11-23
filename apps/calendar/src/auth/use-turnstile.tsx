import { Turnstile, useAuthConfig } from "@delyra/ui";
import { useCallback, useState } from "react";
import { authMessages } from "./messages";

/** Estado del widget Turnstile de un formulario: token actual, elemento y reinicio. */
export function useTurnstile(action: string) {
  const config = useAuthConfig();
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const reset = useCallback(() => setResetKey((key) => key + 1), []);
  const siteKey = config.data?.turnstileSiteKey ?? null;

  let element;
  if (config.isPending) {
    element = <div className="min-h-[65px]" />;
  } else if (!siteKey) {
    element = (
      <p role="alert" className="text-sm text-destructive">
        {authMessages().common.turnstileMissing}
      </p>
    );
  } else {
    element = (
      <Turnstile siteKey={siteKey} action={action} onToken={setToken} resetKey={resetKey} />
    );
  }

  return { token, element, reset };
}
