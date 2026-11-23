import { Button, intlLocale, toast } from "@delyra/ui";
import { CopyIcon, DownloadIcon } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { authMessages } from "./messages";

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
            alt={authMessages().totp.qrAlt}
            className="rounded-md bg-white p-1"
          />
        ) : (
          <div className="size-52 animate-pulse rounded-md bg-muted" />
        )}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">
          {authMessages().totp.manual}
        </summary>
        <code className="mt-2 block rounded-md bg-muted px-3 py-2 font-mono break-all select-all">
          {groupSecret(secret)}
        </code>
      </details>
    </div>
  );
}

function downloadCodes(codes: string[]) {
  const t = authMessages().totp;
  const text = [
    t.fileTitle,
    t.fileGenerated(new Date().toLocaleString(intlLocale())),
    "",
    t.fileOnce,
    t.fileStore,
    "",
    ...codes,
    "",
  ].join("\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = t.fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/** Lista de códigos de recuperación con botones para copiarlos o descargarlos. */
export function RecoveryCodeList({ codes }: { codes: string[] }) {
  const t = authMessages().totp;
  return (
    <div className="grid gap-3">
      <ol
        aria-label={t.codesLabel}
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
              () => toast.success(t.copied),
              () => toast.error(t.copyFailed),
            );
          }}
        >
          <CopyIcon aria-hidden="true" />
          {t.copy}
        </Button>
        <Button variant="outline" onClick={() => downloadCodes(codes)}>
          <DownloadIcon aria-hidden="true" />
          {t.download}
        </Button>
      </div>
    </div>
  );
}

/** Casilla «los he guardado» que desbloquea el botón de continuar. */
export function SavedCodesConfirmation({ onDone, label }: { onDone: () => void; label?: string }) {
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
        {authMessages().totp.saved}
      </label>
      <Button disabled={!saved} onClick={onDone}>
        {label ?? authMessages().common.continue}
      </Button>
    </div>
  );
}
