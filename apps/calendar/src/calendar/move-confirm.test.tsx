import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { describeSlot, type MoveChange, useMoveConfirm } from "./move-confirm";

const TZ = "Europe/Madrid";

describe("describeSlot", () => {
  it("un evento con hora, en el mismo día", () => {
    expect(
      describeSlot(
        { start: "2026-11-24T09:00:00.000Z", end: "2026-11-24T10:30:00.000Z", allDay: false },
        TZ,
        "es-ES",
      ),
    ).toBe("mar, 24 nov · 10:00–11:30");
  });

  it("un evento que cruza la medianoche", () => {
    expect(
      describeSlot(
        { start: "2026-11-24T21:00:00.000Z", end: "2026-11-25T00:30:00.000Z", allDay: false },
        TZ,
        "es-ES",
      ),
    ).toBe("mar, 24 nov 22:00 – mié, 25 nov 01:30");
  });

  it("días completos (el fin es exclusivo)", () => {
    expect(
      describeSlot({ start: "2026-11-24", end: "2026-11-25", allDay: true }, TZ, "es-ES"),
    ).toBe("mar, 24 nov (todo el día)");
    expect(
      describeSlot({ start: "2026-11-24", end: "2026-11-27", allDay: true }, TZ, "es-ES"),
    ).toBe("mar, 24 nov – jue, 26 nov (todo el día)");
  });
});

const CHANGE: MoveChange = {
  title: "Dentista",
  kind: "move",
  before: { start: "2026-11-24T09:00:00.000Z", end: "2026-11-24T10:00:00.000Z", allDay: false },
  after: { start: "2026-11-25T11:00:00.000Z", end: "2026-11-25T12:00:00.000Z", allDay: false },
};

function Harness() {
  const { confirm, dialog } = useMoveConfirm(TZ);
  const [result, setResult] = useState("sin respuesta");
  return (
    <>
      <button
        type="button"
        onClick={() => void confirm(CHANGE).then((ok) => setResult(ok ? "movido" : "cancelado"))}
      >
        Arrastrar
      </button>
      <output>{result}</output>
      {dialog}
    </>
  );
}

describe("useMoveConfirm", () => {
  it("enseña el antes y el después y solo mueve si se confirma", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Arrastrar" }));
    const dialog = await screen.findByRole("dialog", { name: "¿Mover el evento?" });
    expect(dialog).toHaveTextContent("Dentista");
    expect(dialog).toHaveTextContent("Antes: mar, 24 nov · 10:00–11:00");
    expect(dialog).toHaveTextContent("Ahora: mié, 25 nov · 12:00–13:00");
    // El botón de confirmar tiene el foco: Intro confirma, Escape cancela.
    await user.keyboard("{Escape}");
    expect(screen.getByRole("status")).toHaveTextContent("cancelado");

    await user.click(screen.getByRole("button", { name: "Arrastrar" }));
    await user.click(await screen.findByRole("button", { name: "Mover" }));
    expect(screen.getByRole("status")).toHaveTextContent("movido");
  });
});
