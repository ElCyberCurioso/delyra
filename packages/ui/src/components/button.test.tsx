import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";

describe("Button", () => {
  it("es de tipo button por defecto para no enviar formularios por accidente", () => {
    render(<Button>Guardar</Button>);
    expect(screen.getByRole("button", { name: "Guardar" })).toHaveAttribute("type", "button");
  });

  it("respeta type=submit cuando se pide", () => {
    render(<Button type="submit">Enviar</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "submit");
  });

  it("responde a clic y a teclado", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Hola</Button>);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button"));
    await user.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("con asChild renderiza el hijo con aspecto de botón", () => {
    render(
      <Button asChild variant="outline">
        <a href="/ajustes">Ajustes</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Ajustes" });
    expect(link).toHaveAttribute("data-slot", "button");
    expect(link).not.toHaveAttribute("type");
  });
});
