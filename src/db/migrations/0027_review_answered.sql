-- Review by reply (UD-280). Forward only.
--   execute_runs.review_answered  1 when the run only answered the review of a held change (approve, discard or a question): it changed nothing,
--                                 so it is not «the latest result» of the message and the review keeps pointing at the run that held the branch
ALTER TABLE execute_runs ADD COLUMN review_answered INTEGER CHECK (review_answered IN (0, 1));
