import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { handleNotificationBatch } from "../src/jobs/notifications-consumer";

function fakeMessage(body: unknown) {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date(),
    attempts: 1,
    body,
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

describe("handleNotificationBatch", () => {
  it("confirma los mensajes válidos y reintenta los desconocidos (acaban en la DLQ)", async () => {
    const valid = fakeMessage({ type: "noop", idempotencyKey: "k1" });
    const unknown = fakeMessage({ type: "borrar-todo" });
    const batch = {
      queue: "delyra-notifications-local",
      messages: [valid, unknown],
      ackAll: vi.fn(),
      retryAll: vi.fn(),
    } as unknown as MessageBatch;

    await handleNotificationBatch(batch, env);

    expect(valid.ack).toHaveBeenCalledOnce();
    expect(valid.retry).not.toHaveBeenCalled();
    expect(unknown.retry).toHaveBeenCalledOnce();
    expect(unknown.ack).not.toHaveBeenCalled();
  });
});
