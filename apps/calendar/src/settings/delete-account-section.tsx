import { accountDeletionSummarySchema } from "@delyra/shared";
import {
  apiFetch,
  Button,
  clearOfflineData,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  errorMessage,
  forgetUser,
} from "@delyra/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ReauthForm } from "./reauth-form";
import { Section } from "./section";
import { settingsMessages } from "./messages";

/** Página pública a la que se vuelve después de eliminar la cuenta. */
export const ACCOUNT_DELETED_PATH = "/borrar-cuenta?hecho=1";

/**
 * Eliminar la cuenta (F8-12). Google Play lo exige y es el derecho de supresión: se borra al
 * momento, con contraseña y código. Antes se avisa de los tableros compartidos (se borran también
 * para los demás) y la única persona administradora no puede.
 */
export function DeleteAccountSection() {
  const [open, setOpen] = useState(false);
  const t = settingsMessages().deleteAccount;
  return (
    <Section id="eliminar" title={t.title} description={t.description}>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        {t.open}
      </Button>
      {open ? <DeleteAccountDialog onClose={() => setOpen(false)} /> : null}
    </Section>
  );
}

function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const t = settingsMessages().deleteAccount;
  const common = settingsMessages().common;
  const summary = useQuery({
    queryKey: ["account", "deletion"],
    queryFn: () => apiFetch("/api/me/deletion", { schema: accountDeletionSummarySchema }),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.dialogTitle}</DialogTitle>
          <DialogDescription>{t.dialogDescription}</DialogDescription>
        </DialogHeader>
        {summary.isPending ? (
          <p className="text-sm text-muted-foreground">{common.loading}</p>
        ) : summary.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(summary.error)}
          </p>
        ) : summary.data.lastAdmin ? (
          <p role="alert" className="text-sm">
            {t.lastAdmin}
          </p>
        ) : (
          <div className="grid gap-4">
            {summary.data.sharedBoards > 0 ? (
              <p
                role="alert"
                className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm"
              >
                {t.shared(summary.data.sharedBoards, summary.data.sharedWith)}
              </p>
            ) : null}
            <p className="text-sm text-muted-foreground">{t.backupHint}</p>
            <ReauthForm
              destructive
              submitLabel={t.confirm}
              onSubmit={async (body) => {
                await apiFetch("/api/me", { method: "DELETE", body });
                // Como al cerrar sesión: nada de esta cuenta se queda en el navegador.
                forgetUser();
                await clearOfflineData();
                window.location.assign(ACCOUNT_DELETED_PATH);
              }}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
