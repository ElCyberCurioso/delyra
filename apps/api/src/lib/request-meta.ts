import type { Context } from "hono";

/** Datos de la petición útiles para seguridad y auditoría. La IP solo se usa en hashes. */
export interface RequestMeta {
  ip: string;
  country: string | null;
  userAgent: string | null;
}

export function requestMeta(c: Context): RequestMeta {
  const cf = c.req.raw.cf as { country?: string } | undefined;
  const country = c.req.header("cf-ipcountry") ?? cf?.country ?? null;
  return {
    ip: c.req.header("cf-connecting-ip") ?? "127.0.0.1",
    country: country && /^[A-Z]{2}$/.test(country) ? country : null,
    userAgent: c.req.header("user-agent")?.slice(0, 200) ?? null,
  };
}
