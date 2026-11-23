# ADR-0012 · Idiomas (español e inglés) y accesibilidad WCAG 2.2 AA

- **Estado:** aceptada (2026-11-23)
- **Fecha:** 2026-11-23
- **Tareas afectadas:** F7-06

## Decisión

- **Catálogos tipados propios** en lugar de i18next (que preveía el plan): con i18next y
  react-i18next, Trabajo pasaba de su presupuesto de bundle inicial (193 de 210 KB gzip). Cada
  parte de la app define su catálogo en español (`messages.ts`) y la traducción con la misma forma
  (`messages.en.ts`, tipo `Translation<…>`): el compilador obliga a que esté completa, las
  frases con datos son funciones y no hay interpolación en tiempo de ejecución. El inglés se
  descarga en un chunk aparte solo si hace falta (`await` en el módulo del catálogo).
- **Idioma de la página:** con sesión manda el de la cuenta (`user_settings.locale`); se cambia
  desde el menú de usuario o en Ajustes y se guarda. Sin sesión, el elegido en la página de acceso
  o el del navegador (lo primero que sea español o inglés; si no, español). Al cambiarlo se vuelve
  a montar la app (la caché de datos se conserva), se actualizan `<html lang>` y el título.
- **Mensajes del servidor:** la API sigue escribiendo en español; el cliente los traduce al
  mostrarlos (texto exacto o patrón con datos, `server-messages.en.ts`). Una prueba recorre el
  código de la API y de los esquemas compartidos y falla si un mensaje nuevo no tiene traducción.
- **Lo que crea el servidor con nombre** usa el idioma de la petición (`Accept-Language`, que
  manda la SPA): columnas y etiquetas de las plantillas, calendarios por defecto, idioma inicial de
  una cuenta nueva, invitaciones por correo y nombres de los festivos (Nager.Date da el nombre
  inglés; migración 0011 añade `name_en` y vacía la caché para volver a descargarla).
- **Telegram y correos** en el idioma de la cuenta (alertas, resumen diario, avisos de seguridad,
  respuestas del bot). El bot entiende siempre los dos juegos de comandos (`/hoy` y `/today`…);
  `pnpm telegram:setup` registra los comandos en español por defecto y en inglés para quien tiene
  Telegram en inglés. El alta rápida en inglés usa chrono-node/en, que la SPA descarga bajo demanda.
- **Accesibilidad (WCAG 2.2 AA):** `e2e/a11y.spec.ts` pasa axe-core (reglas de WCAG 2.0, 2.1 y 2.2,
  A y AA) por las pantallas principales en tema claro y oscuro. Además: alternativa a arrastrar
  (2.5.7: mover columnas a izquierda/derecha desde sus ajustes; subir y bajar tarjetas y cambiarlas
  de columna desde su detalle), objetivos de al menos 24 px (2.5.8), el foco no queda bajo la
  cabecera fija (2.4.11, `scroll-padding-top`), el nombre accesible del menú de usuario contiene
  su texto visible (2.5.3), contraste de los días de otros meses (1.4.3), colores con nombre y
  `lang` en los enlaces de idioma (3.1.2).

## Consecuencias

- Los textos de datos del usuario (nombres de calendarios y tableros ya creados) no se traducen.
- Las regiones de festivos conservan su nombre oficial en español.
- Límite conocido: FullCalendar no permite enfocar sus zonas con desplazamiento sin romper la
  semántica de su rejilla. Los eventos sí son enfocables, hay atajos (`J`/`K`, `T`) y la vista
  Lista (`L`) es la alternativa accesible; la prueba excluye solo esa regla dentro de `.fc`.
- El correo de fallo del backup del sistema (solo administradores) sigue en español.
