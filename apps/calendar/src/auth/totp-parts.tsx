import { Button, toast } from "@delyra/ui";
import { CopyIcon, DownloadIcon } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

/** `ABCD EFGH …` para teclearla a mano si no se puede escanear el QR. */
function groupSecret(secret: string) {
  return secret.match(/.{1,4}/g)?.join(" ") ?? secret;
}

/** QR de la URI `otpauth://` (generado en el navegador) y la clave para teclearla. */
export function TotpQr({ otpauthUri, secret }: { otpauthUri: string; secret: string }) {
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(otpauthUri, { margin: 1, width: 208 }).then((url) => {
      if (!cancelled) setQr(url);
    });
    return () => {
      cancelled = true;
    };
  }, [otpauthUri]);

  return (
    <div className="grid gap-4">
      <div className="flex justify-center">
        {qr ? (
          <img
            src={qr}
            width={208}
            height={208}
            alt="Código QR para añadir Delyra a tu app autenticadora"
            className="rounded-md bg-white p-1"
          />
        ) : (
          <div className="size-52 animate-pulse rounded-md bg-muted" />
        )}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">
          ¿No puedes escanearlo? Introduce la clave a mano
        </summary>
        <code className="mt-2 block rounded-md bg-muted px-3 py-2 font-mono break-all select-all">
          {groupSecret(secret)}
        </code>
      </details>
    </div>
  );
}

function downloadCodes(codes: string[]) {
  const text = [
    "Delyra · códigos de recuperación",
    `Generados: ${new Date().toLocaleString("es-ES")}`,
    "",
    "Cada código sirve una sola vez para entrar si pierdes el móvil.",
    "Guárdalos en tu gestor de contraseñas o en un lugar seguro.",
    "",
    ...codes,
    "",
  ].join("\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "delyra-codigos-recuperacion.txt";
  link.click();
  URL.revokeObjectURL(url);
}

/** Lista de códigos de recuperación con botones para copiarlos o descargarlos. */
export function RecoveryCodeList({ codes }: { codes: string[] }) {
  return (
    <div className="grid gap-3">
      <ol
        aria-label="Códigos de recuperación"
        className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border bg-muted/40 p-3 font-mono text-sm"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ol>
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          onClick={() => {
            void navigator.clipboard.writeText(codes.join("\n")).then(
              () => toast.success("Códigos copiados"),
              () => toast.error("No se pudieron copiar"),
            );
          }}
        >
          <CopyIcon aria-hidden="true" />
          Copiar
        </Button>
        <Button variant="outline" onClick={() => downloadCodes(codes)}>
          <DownloadIcon aria-hidden="true" />
          Descargar
        </Button>
      </div>
    </div>
  );
}

/** Casilla «los he guardado» que desbloquea el botón de continuar. */
export function SavedCodesConfirmation({
  onDone,
  label = "Continuar",
}: {
  onDone: () => void;
  label?: string;
}) {
  const [saved, setSaved] = useState(false);
  return (
    <div className="grid gap-3">
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4"
          checked={saved}
          onChange={(event) => setSaved(event.target.checked)}
        />
        He guardado los códigos en un lugar seguro.
      </label>
      <Button disabled={!saved} onClick={onDone}>
        {label}
      </Button>
    </div>
  );
}
