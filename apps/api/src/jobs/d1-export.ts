import { z } from "zod";

/**
 * Cliente mínimo de la API REST de exportación de D1 (modo `polling`).
 * https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/export/
 *
 * Los mensajes de error nunca incluyen el token ni la URL firmada del volcado.
 */

export interface D1ExportConfig {
  accountId: string;
  databaseId: string;
  apiToken: string;
  fetch?: typeof fetch;
  apiBase?: string;
}

/** La exportación sigue en curso: el paso del Workflow debe reintentarse más tarde. */
export class D1ExportPendingError extends Error {
  override name = "D1ExportPendingError";
}

/** Error definitivo (credenciales, permisos, exportación fallida): no tiene sentido reintentar. */
export class D1ExportFailedError extends Error {
  override name = "D1ExportFailedError";
}

const exportResponseSchema = z.looseObject({
  success: z.boolean(),
  errors: z.array(z.looseObject({ message: z.string().optional() })).optional(),
  result: z
    .looseObject({
      at_bookmark: z.string().optional(),
      status: z.string().optional(),
      error: z.string().optional(),
      signed_url: z.string().optional(),
      filename: z.string().optional(),
      result: z
        .looseObject({ signed_url: z.string().optional(), filename: z.string().optional() })
        .optional(),
    })
    .nullish(),
});

type ExportResult = NonNullable<z.infer<typeof exportResponseSchema>["result"]>;

export interface ReadyExport {
  signedUrl: string;
  filename: string | null;
}

export class D1ExportClient {
  readonly #config: Required<Omit<D1ExportConfig, "fetch">>;
  readonly #fetch: typeof fetch;

  constructor(config: D1ExportConfig) {
    if (!config.accountId || !config.databaseId || !config.apiToken) {
      throw new D1ExportFailedError(
        "Exportación de D1 no configurada (cuenta, base de datos o token)",
      );
    }
    this.#config = { apiBase: "https://api.cloudflare.com/client/v4", ...config };
    this.#fetch = config.fetch ?? fetch.bind(globalThis);
  }

  get #url(): string {
    const { apiBase, accountId, databaseId } = this.#config;
    return `${apiBase}/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/export`;
  }

  async #post(body: Record<string, unknown>): Promise<ExportResult> {
    const response = await this.#fetch(this.#url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.#config.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (response.status === 401 || response.status === 403 || response.status === 404) {
      throw new D1ExportFailedError(
        `La API de D1 rechazó la exportación (HTTP ${String(response.status)})`,
      );
    }
    if (!response.ok) {
      // 429 y 5xx: transitorios, el Workflow reintenta el paso.
      throw new Error(`La API de D1 respondió HTTP ${String(response.status)}`);
    }

    const parsed = exportResponseSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error("Respuesta de la API de D1 con formato inesperado");
    if (!parsed.data.success || !parsed.data.result) {
      const first = parsed.data.errors?.[0]?.message ?? "sin detalle";
      throw new Error(`La API de D1 devolvió un error: ${first.slice(0, 200)}`);
    }
    return parsed.data.result;
  }

  /** Inicia la exportación y devuelve el bookmark con el que se consulta su estado. */
  async start(): Promise<string> {
    const result = await this.#post({ output_format: "polling" });
    if (!result.at_bookmark) throw new Error("La API de D1 no devolvió `at_bookmark`");
    return result.at_bookmark;
  }

  /** Consulta la exportación. Lanza `D1ExportPendingError` mientras no esté lista. */
  async poll(bookmark: string): Promise<ReadyExport> {
    const result = await this.#post({ output_format: "polling", current_bookmark: bookmark });
    if (result.status === "error") {
      throw new D1ExportFailedError(
        `La exportación de D1 falló: ${(result.error ?? "sin detalle").slice(0, 200)}`,
      );
    }
    const signedUrl = result.result?.signed_url ?? result.signed_url;
    if (!signedUrl) throw new D1ExportPendingError("La exportación de D1 aún no está lista");
    return { signedUrl, filename: result.result?.filename ?? result.filename ?? null };
  }
}
