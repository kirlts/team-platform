-- Handing a message over to a person (UD-269). Forward only; the runner opens the transaction.
--   areas.escalation_member_id  the person who decides in the area. NULL reads as the first active Editor (a person, not an agent).
--   Backfill: the existing areas take the first active Editor.
-- Then the data step: a message whose latest result from Claude is `needs_decision`, `not_mine` or a delivery held for review, and that has
-- no person assigned, is handed over now as the platform does it from here on: the agent leaves the assignees, the person who decides in
-- the area joins them, the message goes back to `open` and the last reply of the agent becomes a question (`clarification`). Each one is
-- written to `audit_log` as `message.escalate`. A message with a queued or running job is skipped: someone has just asked Claude again.

ALTER TABLE areas ADD COLUMN escalation_member_id INTEGER REFERENCES members (id) ON DELETE SET NULL;

UPDATE areas SET escalation_member_id = (SELECT id FROM members WHERE role = 'editor' AND kind = 'person' AND active = 1 ORDER BY id LIMIT 1);

CREATE TEMP TABLE handoff_buried AS
SELECT m.id AS message_id,
       r.outcome AS outcome,
       COALESCE(r.delivery_held, 0) AS held,
       CASE
         WHEN a.escalation_member_id IN (SELECT id FROM members WHERE kind = 'person' AND active = 1) THEN a.escalation_member_id
         ELSE COALESCE(
           (SELECT id FROM members WHERE role = 'editor' AND kind = 'person' AND active = 1 ORDER BY id LIMIT 1),
           (SELECT id FROM members WHERE id = m.author_id AND kind = 'person' AND active = 1))
       END AS person_id
  FROM messages m
  JOIN areas a ON a.id = m.area_id
  JOIN execute_runs r ON r.id = (
         SELECT x.id FROM execute_runs x
          WHERE x.message_id = m.id AND x.outcome IS NOT NULL AND x.outcome NOT IN ('aborted', 'failed')
          ORDER BY x.started_at DESC, x.id DESC LIMIT 1)
 WHERE m.deleted_at IS NULL AND m.status <> 'closed'
   AND (r.outcome IN ('needs_decision', 'not_mine') OR r.delivery_held = 1)
   AND NOT EXISTS (SELECT 1 FROM message_assignees x JOIN members p ON p.id = x.member_id WHERE x.message_id = m.id AND p.kind = 'person')
   AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.message_id = m.id AND j.kind IN ('execute', 'deliver') AND j.status IN ('queued', 'running'));

DELETE FROM handoff_buried WHERE person_id IS NULL;

UPDATE replies SET kind = 'clarification'
 WHERE id IN (SELECT (SELECT MAX(r.id) FROM replies r JOIN members g ON g.id = r.author_id AND g.kind = 'agent'
                       WHERE r.message_id = b.message_id AND r.deleted_at IS NULL)
                FROM handoff_buried b);

DELETE FROM message_assignees
 WHERE message_id IN (SELECT message_id FROM handoff_buried)
   AND member_id IN (SELECT id FROM members WHERE kind = 'agent');

INSERT OR IGNORE INTO message_assignees (message_id, member_id) SELECT message_id, person_id FROM handoff_buried;

UPDATE messages SET status = 'open' WHERE id IN (SELECT message_id FROM handoff_buried);

INSERT INTO audit_log (at, member_id, action, entity, entity_id, detail_json)
SELECT CAST(strftime('%s', 'now') AS INTEGER) * 1000, NULL, 'message.escalate', 'message', message_id,
       json_object('to', person_id, 'source', 'migration 0021', 'result', CASE WHEN held = 1 THEN 'delivery_held' ELSE outcome END)
  FROM handoff_buried;

DROP TABLE handoff_buried;
