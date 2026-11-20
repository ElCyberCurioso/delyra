import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ApiError, apiFetch, errorMessage } from "./api";
import { authUrl, fetchMe, goTo, pendingStepUrl, resolveNext } from "./session";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("destinos tras el login", () => {
  it("acepta rutas propias y orígenes de Delyra, nunca otros dominios", () => {
    expect(resolveNext("/semana?d=1")).toBe("/semana?d=1");
    expect(resolveNext("http://localhost:5174/tablero")).toBe("http://localhost:5174/tablero");
    expect(resolveNext("https://evil.example/")).toBe("/");
    expect(resolveNext("//evil.example")).toBe("/");
    expect(resolveNext("javascript:alert(1)")).toBe("/");
    expect(resolveNext(undefined)).toBe("/");
  });

  it("los pasos pendientes viven en el calendario y conservan el destino", () => {
    const url = new URL(authUrl("/login", "http://localhost:5174/tablero"));
    expect(url.origin).toBe("http://localhost:5173");
    expect(url.searchParams.get("next")).toBe("http://localhost:5174/tablero");
    expect(pendingStepUrl("pending_2fa", "/")).toBe(
      "http://localhost:5173/login/verificar?next=%2F",
    );
    expect(pendingStepUrl("pending_totp", "/")).toBe(
      "http://localhost:5173/configurar-2fa?next=%2F",
    );
    expect(pendingStepUrl("active")).toBeNull();
  });

  it("navega dentro de la SPA solo si el destino es del mismo origen", () => {
    const visited: string[] = [];
    goTo("http://localhost:5173/login?next=%2F", (path) => visited.push(path));
    expect(visited).toEqual(["/login?next=%2F"]);
  });
});

describe("cliente de la API", () => {
  it("envía JSON y convierte problem+json en ApiError con errores por campo", async () => {
    server.use(
      http.post("/api/auth/register", async ({ request }) => {
        expect(request.headers.get("content-type")).toBe("application/json");
        expect(await request.json()).toEqual({ name: "x" });
        return HttpResponse.json(
          {
            type: "https://delyra.app/problems/validation",
            title: "Datos no válidos",
            status: 422,
            errors: [{ path: "password", message: "Demasiado corta" }],
          },
          { status: 422, headers: { "Content-Type": "application/problem+json" } },
        );
      }),
    );
    const error = await apiFetch("/api/auth/register", {
      method: "POST",
      body: { name: "x" },
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(422);
    expect((error as ApiError).fieldError("password")).toBe("Demasiado corta");
  });

  it("trata el 401 de /me como visitante anónimo", async () => {
    server.use(
      http.get("/api/auth/me", () =>
        HttpResponse.json({ type: "about:blank", title: "x", status: 401 }, { status: 401 }),
      ),
    );
    expect(await fetchMe()).toEqual({ state: "anonymous", user: null, settings: null });
  });

  it("da un mensaje claro ante el límite de intentos", () => {
    expect(errorMessage(new ApiError(429, null))).toMatch(/Demasiados intentos/);
  });
});
