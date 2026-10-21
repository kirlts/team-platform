-- UD-023: one free-text profile per member replaces `responsibilities` and `domains`. Forward only; the runner
-- opens the transaction.
--   members.profile   two paragraphs the person writes about themselves; the whole text travels to the analyzer.
-- Backfill: the old fields are joined into prose, each line only when it has content:
--   «Responsabilidades: <responsibilities>»
--   «Dominios: <domains joined by ", ">»
-- A member with neither ends with an empty profile. `domains` held a JSON array; a value that is not a JSON
-- array counts as empty. Then both columns are dropped (SQLite 3.35+ supports DROP COLUMN).

ALTER TABLE members ADD COLUMN profile TEXT NOT NULL DEFAULT '';

UPDATE members
   SET profile = CASE WHEN trim(responsibilities) <> '' THEN 'Responsabilidades: ' || trim(responsibilities) ELSE '' END;

UPDATE members
   SET profile = members.profile || CASE WHEN members.profile <> '' THEN char(10) ELSE '' END || 'Dominios: ' || x.joined
  FROM (
    SELECT m.id,
           CASE WHEN json_valid(m.domains) AND json_type(m.domains) = 'array'
                THEN coalesce((SELECT group_concat(trim(CAST(j.value AS TEXT)), ', ') FROM json_each(m.domains) AS j WHERE trim(CAST(j.value AS TEXT)) <> ''), '')
                ELSE '' END AS joined
      FROM members AS m
  ) AS x
 WHERE x.id = members.id AND x.joined <> '';

ALTER TABLE members DROP COLUMN responsibilities;
ALTER TABLE members DROP COLUMN domains;
