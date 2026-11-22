-- F7-04: hasta ahora solo escribía el dueño del tablero. A partir de aquí, `author_id`/`actor_id`
-- nulos significan «cuenta borrada» u «otra persona» (copias restauradas), nunca el dueño.
UPDATE `card_comments` SET `author_id` = `owner_id` WHERE `author_id` IS NULL;--> statement-breakpoint
UPDATE `card_activity` SET `actor_id` = `owner_id` WHERE `actor_id` IS NULL;
