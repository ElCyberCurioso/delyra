import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";

/**
 * Markdown de las descripciones (F4-09). Doble barrera: markdown-it no acepta HTML (`html:
 * false`) ni enlaces `javascript:`, y DOMPurify limpia el resultado con una lista cerrada de
 * etiquetas. Los enlaces se abren aparte y sin referer.
 */

const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false });

const ALLOWED_TAGS = [
  "a",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
];

let hooked = false;

function purifier() {
  if (!hooked) {
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      if (node.tagName === "A") {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer nofollow");
      }
    });
    hooked = true;
  }
  return DOMPurify;
}

export function renderMarkdown(source: string): string {
  return purifier().sanitize(md.render(source), {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ["href", "title", "target", "rel"],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
  });
}

/** Markdown ya convertido y saneado (el único sitio del frontend que inserta HTML). */
export function Markdown({ source, className }: { source: string; className?: string }) {
  const html = renderMarkdown(source);
  // nosemgrep -- HTML generado por markdown-it sin HTML de entrada y saneado con DOMPurify (arriba)
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
