import { useEffect, useRef } from "react";

/**
 * Atajos de teclado de una página (F7-07). No se disparan mientras se escribe (campos de texto,
 * selects, áreas editables), con un diálogo abierto ni con Ctrl, Alt o Meta (no pisan los del
 * navegador ni los del lector de pantalla).
 */

export interface Shortcut {
  /** Teclas tal como las da `KeyboardEvent.key` («n», «?», «ArrowLeft»…). */
  keys: readonly string[];
  /** Cómo se muestra en la ayuda («N», «←»…). */
  label: string;
  description: string;
  run: () => void;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable ||
    target.closest("[role='dialog'], [role='menu'], [role='listbox']") !== null
  );
}

export function useShortcuts(shortcuts: readonly Shortcut[], enabled = true): void {
  // La lista cambia en cada render; el listener lee siempre la última.
  const current = useRef(shortcuts);
  useEffect(() => {
    current.current = shortcuts;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTyping(event.target) || document.querySelector("[role='dialog']")) return;
      const shortcut = current.current.find((s) => s.keys.includes(event.key));
      if (!shortcut) return;
      event.preventDefault();
      shortcut.run();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
