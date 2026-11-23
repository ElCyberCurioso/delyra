import { COLOR_PALETTE } from "@delyra/shared";
import { BanIcon, PipetteIcon } from "lucide-react";
import { useId } from "react";
import { ui } from "../i18n";
import { cn } from "../lib/utils";

/**
 * Selector de color común (calendarios, etiquetas y tarjetas): paleta con nombre, color
 * personalizado con el selector nativo del sistema y, si se pide, «sin color».
 */
export function ColorPicker({
  legend,
  value,
  onChange,
  allowNone = false,
  className,
}: {
  legend: string;
  value: string | null;
  onChange: (color: string | null) => void;
  allowNone?: boolean;
  className?: string;
}) {
  const t = ui().colorPicker;
  const names: Readonly<Record<string, string>> = ui().colors;
  const current = value?.toLowerCase() ?? null;
  const custom = current !== null && !COLOR_PALETTE.some((c) => c.hex === current);
  const customId = useId();
  const swatch =
    "relative grid size-7 place-items-center rounded-full ring-offset-2 ring-offset-background transition-transform hover:scale-110 focus-visible:ring-[3px] focus-visible:ring-ring/60 focus-visible:outline-none motion-reduce:transition-none motion-reduce:hover:scale-100";
  return (
    <fieldset className={cn("grid gap-2", className)}>
      <legend className="mb-1.5 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {allowNone ? (
          <button
            type="button"
            aria-label={t.none}
            aria-pressed={current === null}
            onClick={() => onChange(null)}
            className={cn(
              swatch,
              "border border-dashed text-muted-foreground",
              current === null && "ring-2 ring-ring",
            )}
          >
            <BanIcon aria-hidden="true" className="size-3.5" />
          </button>
        ) : null}
        {COLOR_PALETTE.map((color) => (
          <button
            key={color.key}
            type="button"
            aria-label={names[color.key] ?? color.hex}
            aria-pressed={current === color.hex}
            onClick={() => onChange(color.hex)}
            className={cn(swatch, current === color.hex && "ring-2 ring-ring")}
            style={{ backgroundColor: color.hex }}
          />
        ))}
        <span
          className={cn(
            swatch,
            "border border-dashed text-muted-foreground focus-within:ring-[3px] focus-within:ring-ring/60",
            custom && "border-transparent ring-2 ring-ring",
          )}
          style={custom && current ? { backgroundColor: current } : undefined}
        >
          <PipetteIcon
            aria-hidden="true"
            className={cn("size-3.5", custom && "text-white mix-blend-difference")}
          />
          <label htmlFor={customId} className="sr-only">
            {custom ? t.customChosen(current) : t.custom}
          </label>
          <input
            id={customId}
            type="color"
            value={current ?? "#7c5cff"}
            onChange={(e) => onChange(e.target.value.toLowerCase())}
            className="absolute inset-0 size-full cursor-pointer rounded-full opacity-0"
          />
        </span>
      </div>
    </fieldset>
  );
}
