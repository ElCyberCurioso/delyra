import { describe, expect, it, vi } from "vitest";
import { isApiPath, routeFrontendRequest } from "./edge";

function bindings() {
  return {
    API: { fetch: vi.fn((_: Request) => Promise.resolve(new Response("api"))) },
    ASSETS: { fetch: vi.fn((_: Request) => Promise.resolve(new Response("asset"))) },
  };
}

describe("routeFrontendRequest", () => {
  it("reenvía /api/* al Worker api con la petición original", async () => {
    const env = bindings();
    const request = new Request("https://delyra.app/api/health?x=1", {
      method: "POST",
      headers: { Cookie: "__Secure-sid=abc", Origin: "https://delyra.app" },
    });
    const response = await routeFrontendRequest(request, env);
    expect(await response.text()).toBe("api");
    expect(env.API.fetch).toHaveBeenCalledWith(request);
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it.each(["/", "/calendario/2026/11", "/apis", "/assets/index.js", "/api-docs"])(
    "sirve %s desde Static Assets",
    async (path) => {
      const env = bindings();
      await routeFrontendRequest(new Request(`https://delyra.app${path}`), env);
      expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
      expect(env.API.fetch).not.toHaveBeenCalled();
    },
  );
});

describe("isApiPath", () => {
  it("solo reconoce /api y sus subrutas", () => {
    expect(isApiPath("/api")).toBe(true);
    expect(isApiPath("/api/")).toBe(true);
    expect(isApiPath("/api/auth/me")).toBe(true);
    expect(isApiPath("/apix")).toBe(false);
    expect(isApiPath("/x/api/")).toBe(false);
  });
});
