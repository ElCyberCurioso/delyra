# ADR-0011 · Tableros compartidos y tiempo real

- **Estado:** aceptada (2026-11-22)
- **Fecha:** 2026-11-22
- **Tareas afectadas:** F7-04, F7-05

## Decisión

- **Propiedad.** Un tablero sigue siendo de quien lo creó: todas sus filas conservan su
  `owner_id` (copias, cuotas, adjuntos en R2 y borrado de cuenta no cambian). Compartir añade
  `board_members` (tablero, persona, papel) y `board_invitations` (por email, 14 días).
- **Papeles.** `owner` (todo, incluido borrar el tablero, invitar y gestionar miembros), `editor`
  (crear, mover, editar y comentar tarjetas, columnas y etiquetas) y `reader` (solo ver y descargar
  adjuntos). Cada endpoint del kanban resuelve el tablero del recurso que toca
  (`services/board-access.ts`) y exige `read`, `write` u `owner`; sin acceso, 404 (no se revela
  que existe); con acceso insuficiente, 403. Los comentarios solo los edita su autor; los borra su
  autor o el dueño. Los avisos por Telegram de una tarjeta le llegan al dueño, así que solo él los
  elige. Hasta 20 miembros por tablero.
- **Invitaciones por email**, sin revelar si la dirección tiene cuenta: la respuesta es la misma
  exista o no. Solo las ve (y acepta) quien entra con ese email. La lista de miembros muestra los
  emails solo al dueño.
- **Tiempo real** con un Durable Object por tablero (`BoardRoom`) y WebSocket Hibernation. La API
  autoriza la conexión (sesión completa, papel en el tablero y `Origin` de la aplicación, contra el
  secuestro del WebSocket desde otro sitio) y la pasa al objeto. Por el canal **no viajan datos**:
  solo «ha cambiado» (con quién lo hizo) y quién está mirando. Los clientes vuelven a pedir el
  tablero a la API, que es la única fuente de verdad: dos cambios a la vez se resuelven con el
  último que llega y todos acaban viendo lo mismo. Al quitar a alguien, su conexión recibe
  `revoked` y se cierra con 4403. `ping` lo responde el runtime sin despertar el objeto.
- **Autoría.** `card_comments.author_id` y `card_activity.actor_id` (migraciones 0009 y 0010,
  rellenadas con el dueño para lo anterior). Nulo significa cuenta borrada u otra persona.

## Consecuencias

- La copia de seguridad de una cuenta incluye sus tableros (también lo que escribieron otros en
  ellos, marcado `byOwner: false`) pero no los miembros. Al restaurar, lo ajeno queda sin autor: una
  copia nunca apunta a otra cuenta. Los tableros de otros en los que participa alguien no entran
  en su copia.
- La capa «Tareas» del calendario solo muestra tarjetas de tableros propios.
- Si el canal en vivo no conecta (red, proxy), la app funciona igual: los datos se refrescan al
  volver a la pestaña y tras cada cambio propio.
- Coste: una conexión por pestaña abierta en un tablero; mientras nadie escribe, el objeto hiberna.
