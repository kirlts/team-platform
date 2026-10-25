-- The notice of a failed session is marked when «Reintentar» launches another one (UD-290). Forward only; the runner opens the transaction.
--   replies.replaced_by_job_id  the job that replaced it (NULL while nobody retried). The notice is not deleted, so the audit keeps it; the thread
--                               draws it as «Reintentando» while that job is queued or running and omits it when it ends, because its result
--                               (the answer, or a new notice with its reason) already takes its place.
ALTER TABLE replies ADD COLUMN replaced_by_job_id INTEGER;
