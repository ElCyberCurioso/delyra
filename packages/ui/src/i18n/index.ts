import { defineMessages } from "./core";
import { type ServerMessages, serverEs, translateWith } from "./server-messages";
import { uiEs } from "./ui-messages";

export {
  browserLocale,
  defineMessages,
  getLocale,
  intlLocale,
  LOCALE_STORAGE_KEY,
  setLocale,
  subscribeLocale,
  type Translation,
} from "./core";
export { formatDate, formatDateTime, formatShortDateTime, formatSize } from "./format";
export { LOCALE_NAMES } from "./ui-messages";

/** Textos de los componentes comunes en el idioma actual. */
export const ui = await defineMessages(uiEs, () => import("./ui-messages.en"));

const server = await defineMessages<ServerMessages, ServerMessages>(
  serverEs,
  () => import("./server-messages.en"),
);

/** Un mensaje del servidor (o de un esquema compartido) en el idioma actual. */
export function translateServer(text: string): string {
  return translateWith(server(), text);
}
