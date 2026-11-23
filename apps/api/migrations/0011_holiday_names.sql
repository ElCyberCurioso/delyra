ALTER TABLE `public_holidays` ADD `name_en` text;--> statement-breakpoint
-- F7-06: se vacía la caché para que la próxima consulta descargue también los nombres en inglés.
DELETE FROM `public_holidays`;
