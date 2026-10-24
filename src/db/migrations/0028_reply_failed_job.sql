-- Reintentar una sesión que falló (UD-282). Forward only; the runner opens the transaction.
--   replies.failed_job_id  the `execute` job whose failure this reply tells (NULL in every other reply). The notice of a failed session carries it so
--                          that «Reintentar» launches the same job again (same message, same mention or forward, same files) and never guesses it from the text.
ALTER TABLE replies ADD COLUMN failed_job_id INTEGER;
--   replies.failed_code    the stable code of that failure (`execute_timeout`, `lease_expired`...): only a cause that a second try can fix offers «Reintentar».
ALTER TABLE replies ADD COLUMN failed_code TEXT;
