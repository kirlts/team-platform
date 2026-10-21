-- UD-045: each area has a color the Editor chooses (one value, `#rrggbb`). The panel derives the secondary tint and the
-- text colors from it, so only this one is stored. Forward only; the runner opens the transaction.
-- Backfill: the five initial areas get the color of templates/areas.json; any other area gets the next color of the
-- same palette by its id, so no area is left without one and neighbours differ.

ALTER TABLE areas ADD COLUMN color TEXT NOT NULL DEFAULT '#4f46e5';

UPDATE areas SET color = CASE title
  WHEN 'Idea' THEN '#6d28d9'
  WHEN 'Error' THEN '#c2410c'
  WHEN 'Nueva funcionalidad' THEN '#15803d'
  WHEN 'Retroalimentación' THEN '#0f766e'
  WHEN 'Pregunta' THEN '#a21caf'
  ELSE CASE (id - 1) % 8
    WHEN 0 THEN '#6d28d9' WHEN 1 THEN '#c2410c' WHEN 2 THEN '#15803d' WHEN 3 THEN '#0f766e'
    WHEN 4 THEN '#a21caf' WHEN 5 THEN '#4d7c0f' WHEN 6 THEN '#be185d' ELSE '#0369a1' END
END;
