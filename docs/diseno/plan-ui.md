# Plan de mejora de la interfaz (noviembre de 2026)

Objetivo: que Delyra deje de parecer una plantilla genérica sin perder lo que ya funciona
(accesibilidad WCAG 2.2 AA, rendimiento dentro del presupuesto y modo oscuro).

## Dirección

- **Mosaicos tipo bento.** Cada bloque de información es un mosaico (`tile`): esquinas de 1,25 rem,
  borde fino, sombra suave en capas y fondo de tarjeta sobre un lienzo con un ligero brillo de la
  marca en las esquinas. Los mosaicos se agrupan en rejillas de tamaños distintos (uno grande que
  manda y varios pequeños con cifras o accesos), no en listas uniformes.
- **Tipografía con carácter.** Plus Jakarta Sans variable, servida desde la propia app (la CSP no
  admite fuentes de otros orígenes). Títulos grandes y en negrita con tracking negativo; cifras
  tabulares en los contadores.
- **Color.** Cinco gamas completas (claro y oscuro), elegibles desde el menú de usuario
  («Gama de color») mientras se decide la definitiva. Cada gama define los mismos tokens
  (`--primary`, `--accent`, `--background`, `--brand-1`, `--brand-2`…), así que los componentes no
  saben cuál está activa; los contrastes se comprueban con axe-core en las cinco.
  - **Aurora** (por defecto): violeta y fucsia sobre neutros fríos.
  - **Bosque**: esmeralda y lima sobre arena.
  - **Coral**: coral y ámbar sobre crema.
  - **Océano**: azul profundo y cian sobre pizarra.
  - **Grafito**: casi monocromo con un toque ámbar.

  Comparativa de las cinco (claro y oscuro): [gamas.jpg](gamas.jpg).

- **La gama sigue a la cuenta.** Se guarda en `user_settings.palette` (migración 0013), como el
  idioma: es la misma en delyra.app y work.delyra.app y en cualquier dispositivo. El navegador la
  recuerda también en `localStorage` para pintarla antes de cargar la sesión (`/theme-init.js`),
  sin destellos.
- **Más colores.** Paleta común de 18 colores con nombre (`packages/shared/src/colors.ts`) más un color libre,
  para calendarios, etiquetas y tarjetas. Los eventos oscurecen el fondo lo justo para que el texto
  blanco cumpla 4,5:1 con cualquier color.
- **Animación con propósito.** Solo CSS (sin librerías que pesen en el bundle):
  - entrada escalonada de los mosaicos (`animate-rise` con `--i`);
  - elevación al pasar por encima (`lift`) y pulsación de botones (`press`);
  - tarjetas nuevas con un pequeño rebote (`animate-pop`); diálogos y menús que aparecen desde
    abajo con desenfoque del fondo; el botón de cerrar gira; la marca se inclina al pasar.
  - Todo se desactiva con «reducir movimiento» (WCAG 2.3.3).

## Pantallas

| Pantalla                 | Cambio                                                                                                                                                                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Acceso, registro, 2FA    | Panel de marca a la izquierda (en pantallas anchas) con mosaicos de lo que ofrece Delyra; el formulario, en un mosaico a la derecha.                                                                                                    |
| Calendario               | Barra lateral en mosaicos (minicalendario, calendarios, filtros), calendario en un mosaico, selector de vista segmentado, eventos redondeados con relieve, «hoy» destacado con el color de la gama.                                     |
| Tableros                 | Cabecera bento: mosaico grande con degradado y botón de crear, y tres cifras (tableros, tarjetas abiertas, compartidos). Cada tablero, un mosaico con icono de su plantilla; el primero ocupa dos filas; mosaico final para crear otro. |
| Tablero                  | Columnas más anchas (21–22,5 rem) y de la altura del tablero; en el móvil vertical se apilan y se pueden plegar. Tarjetas con relieve, franja de su color y elevación al pasar.                                                         |
| Ajustes y administración | Rejilla bento de dos columnas (perfil, copias y actividad a lo ancho) y navegación lateral fija en un mosaico.                                                                                                                          |

## Pendiente de decidir

- Gama definitiva: cuando se elija, se deja como la de por defecto y se puede quitar el selector
  (o mantenerlo como preferencia personal).
- Ilustraciones o iconos propios para los estados vacíos.
