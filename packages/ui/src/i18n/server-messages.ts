/**
 * Mensajes que llegan de la API o de los esquemas compartidos (problem+json, errores de campo,
 * informes de importación y restauración). Se escriben en español en el servidor y se traducen
 * al mostrarlos: por coincidencia exacta o, si llevan datos, con un patrón.
 */
export interface ServerMessages {
  exact: Readonly<Record<string, string>>;
  patterns: readonly (readonly [RegExp, (...groups: string[]) => string])[];
}

export const serverEs: ServerMessages = { exact: {}, patterns: [] };

export function translateWith(messages: ServerMessages, text: string): string {
  const exact = messages.exact[text];
  if (exact !== undefined) return exact;
  for (const [pattern, render] of messages.patterns) {
    const match = pattern.exec(text);
    if (match) return render(...match.slice(1));
  }
  return text;
}
