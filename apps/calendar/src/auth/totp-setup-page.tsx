import { totpConfirmResponseSchema, totpSetupResponseSchema } from "@delyra/shared";
import {
  apiFetch,
  AuthLayout,
  Button,
  errorMessage,
  Field,
  FormError,
  FullPageSpinner,
  goTo,
  ME_QUERY_KEY,
  resolveNext,
  toast,
  useMe,
} from "@delyra/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { CopyIcon, DownloadIcon } from "lucide-react";
import QRCode from "qrcode";
import { formValues, useNextParam } from "./form";
import { type FormEvent, useEffect, useState } from "react";

/** `ABCD EFGH …` para teclearla a mano si no se puede escanear el QR. */
function groupSecret(secret: string) {
  return secret.match(/.{1,4}/g)?.join(" ") ?? secret;
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

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  return (
    <AuthLayout
      title="Guarda tus códigos de recuperación"
      description="Si pierdes el móvil, cada uno de estos códigos te deja entrar una vez. No volverás a verlos."
    >
      <div className="grid gap-4">
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
          Continuar
        </Button>
      </div>
    </AuthLayout>
  );
}

/** Alta obligatoria del TOTP: QR, confirmación con un código y códigos de recuperación. */
export function TotpSetupPage() {
  const next = useNextParam();
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useMe();
  const [qr, setQr] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const state = me.data?.state;

  // Cada llamada genera una semilla nueva: una sola vez y sin refrescos automáticos.
  const setup = useQuery({
    queryKey: ["auth", "totp-setup"],
    enabled: state === "pending_totp",
    queryFn: () =>
      apiFetch("/api/auth/totp/setup", { method: "POST", schema: totpSetupResponseSchema }),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  useEffect(() => {
    if (!setup.data) return;
    void QRCode.toDataURL(setup.data.otpauthUri, { margin: 1, width: 208 }).then(setQr);
  }, [setup.data]);

  useEffect(() => {
    if (codes) return;
    if (state === "active") goTo(resolveNext(next), (path) => router.history.replace(path));
    if (state === "pending_2fa") {
      void router.navigate({ to: "/login/verificar", search: { next }, replace: true });
    }
    if (state === "anonymous") {
      void router.navigate({ to: "/login", search: { next }, replace: true });
    }
  }, [state, next, router, codes]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = (formValues(event.currentTarget).code ?? "").replace(/\s+/g, "");
    if (!/^\d{6}$/.test(code)) {
      setFormError("Introduce los 6 dígitos que muestra tu app.");
      return;
    }
    setFormError(null);
    setPending(true);
    try {
      const result = await apiFetch("/api/auth/totp/confirm", {
        method: "POST",
        body: { code },
        schema: totpConfirmResponseSchema,
      });
      setCodes(result.recoveryCodes);
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  if (codes) {
    return (
      <RecoveryCodes
        codes={codes}
        onDone={() => {
          void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }).then(() => {
            goTo(resolveNext(next), (path) => router.history.push(path));
          });
        }}
      />
    );
  }
  if (state !== "pending_totp") return <FullPageSpinner />;
  if (setup.isError) {
    return (
      <AuthLayout
        title="No se pudo preparar la verificación"
        description={errorMessage(setup.error)}
      >
        <Button className="w-full" onClick={() => void setup.refetch()}>
          Reintentar
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Activa la verificación en dos pasos"
      description="Es obligatoria. Escanea el código con una app autenticadora (Google Authenticator, 1Password, Bitwarden, Aegis…)."
    >
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
        {setup.data ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              ¿No puedes escanearlo? Introduce la clave a mano
            </summary>
            <code className="mt-2 block rounded-md bg-muted px-3 py-2 font-mono break-all select-all">
              {groupSecret(setup.data.secret)}
            </code>
          </details>
        ) : null}
        <form noValidate onSubmit={(event) => void onSubmit(event)} className="grid gap-4">
          <FormError>{formError}</FormError>
          <Field
            label="Código de 6 dígitos"
            name="code"
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            required
          />
          <Button type="submit" disabled={pending || !setup.data}>
            {pending ? "Comprobando…" : "Activar"}
          </Button>
        </form>
      </div>
    </AuthLayout>
  );
}
