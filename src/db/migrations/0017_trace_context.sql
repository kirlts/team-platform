-- One OpenTelemetry trace per message (UD-262): the trace id and the W3C `traceparent` of the span that last touched the
-- row travel from the input to the analysis job, to the published message and to the `execute` job. A job also keeps the
-- context of its latest attempt (`last_span`) so the next attempt links to it. `phase` is the current step of a running
-- `execute` job. NULL on rows that predate this migration. Forward only; the runner opens the transaction.

-- `spans.links_json` keeps the span links (the previous attempt or job a span points at).
ALTER TABLE spans ADD COLUMN links_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE inputs ADD COLUMN trace_id TEXT;
ALTER TABLE inputs ADD COLUMN traceparent TEXT;
ALTER TABLE messages ADD COLUMN trace_id TEXT;
ALTER TABLE messages ADD COLUMN traceparent TEXT;
ALTER TABLE jobs ADD COLUMN trace_id TEXT;
ALTER TABLE jobs ADD COLUMN traceparent TEXT;
ALTER TABLE jobs ADD COLUMN link_traceparent TEXT;
ALTER TABLE jobs ADD COLUMN last_span TEXT;
ALTER TABLE jobs ADD COLUMN phase TEXT;
