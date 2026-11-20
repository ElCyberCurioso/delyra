import { z } from "zod";

/**
 * Errores de la API en formato RFC 9457 (`application/problem+json`).
 * Nunca incluyen trazas ni detalles internos; `requestId` permite cruzarlos con los logs.
 */
export const PROBLEM_CONTENT_TYPE = "application/problem+json";

export const PROBLEM_TYPES = {
  badRequest: "urn:delyra:problem:bad-request",
  validation: "urn:delyra:problem:validation",
  unauthorized: "urn:delyra:problem:unauthorized",
  forbidden: "urn:delyra:problem:forbidden",
  notFound: "urn:delyra:problem:not-found",
  methodNotAllowed: "urn:delyra:problem:method-not-allowed",
  conflict: "urn:delyra:problem:conflict",
  payloadTooLarge: "urn:delyra:problem:payload-too-large",
  unsupportedMediaType: "urn:delyra:problem:unsupported-media-type",
  rateLimited: "urn:delyra:problem:rate-limited",
  internal: "urn:delyra:problem:internal",
  unavailable: "urn:delyra:problem:service-unavailable",
} as const;

export type ProblemType = (typeof PROBLEM_TYPES)[keyof typeof PROBLEM_TYPES];

export const invalidParamSchema = z.object({
  path: z.string(),
  message: z.string(),
});

export type InvalidParam = z.infer<typeof invalidParamSchema>;

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  /** Extensión propia: permite cruzar el error con los logs. */
  requestId?: string;
  /** Extensión propia: errores de validación por campo. */
  errors?: InvalidParam[];
}

/** Admite miembros de extensión desconocidos, como permite la RFC 9457. */
export const problemDetailsSchema = z.looseObject({
  type: z.string().min(1),
  title: z.string().min(1),
  status: z.number().int().min(400).max(599),
  detail: z.string().optional(),
  instance: z.string().optional(),
  requestId: z.string().optional(),
  errors: z.array(invalidParamSchema).optional(),
});

const STATUS_DEFAULTS: Readonly<Record<number, { type: ProblemType; title: string }>> = {
  400: { type: PROBLEM_TYPES.badRequest, title: "Petición no válida" },
  401: { type: PROBLEM_TYPES.unauthorized, title: "Autenticación requerida" },
  403: { type: PROBLEM_TYPES.forbidden, title: "Acceso denegado" },
  404: { type: PROBLEM_TYPES.notFound, title: "Recurso no encontrado" },
  405: { type: PROBLEM_TYPES.methodNotAllowed, title: "Método no permitido" },
  409: { type: PROBLEM_TYPES.conflict, title: "Conflicto con el estado actual" },
  413: { type: PROBLEM_TYPES.payloadTooLarge, title: "Petición demasiado grande" },
  415: { type: PROBLEM_TYPES.unsupportedMediaType, title: "Tipo de contenido no admitido" },
  422: { type: PROBLEM_TYPES.validation, title: "Datos no válidos" },
  429: { type: PROBLEM_TYPES.rateLimited, title: "Demasiadas peticiones" },
  500: { type: PROBLEM_TYPES.internal, title: "Error interno" },
  503: { type: PROBLEM_TYPES.unavailable, title: "Servicio no disponible" },
};

export type ProblemInit = Partial<Omit<ProblemDetails, "status">>;

/** Crea un `ProblemDetails` con el tipo y el título por defecto del código HTTP. */
export function createProblem(status: number, init: ProblemInit = {}): ProblemDetails {
  if (!Number.isInteger(status) || status < 400 || status > 599) {
    throw new RangeError(`Código HTTP de error no válido: ${String(status)}`);
  }
  const fallback = status >= 500 ? STATUS_DEFAULTS[500] : STATUS_DEFAULTS[400];
  const defaults = STATUS_DEFAULTS[status] ?? fallback;
  return {
    type: defaults?.type ?? PROBLEM_TYPES.internal,
    title: defaults?.title ?? "",
    ...init,
    status,
  };
}

export function isProblemDetails(value: unknown): value is ProblemDetails {
  return problemDetailsSchema.safeParse(value).success;
}
