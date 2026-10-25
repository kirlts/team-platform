-- The cost and the tokens of an `execute` run by model, subagents included. Forward only; the runner opens the transaction.
--   execute_runs.model_usage_json   `[{ model, input, output, cache_read, cache_write, cli_cost_usd, cost_basis, cost_usd, cost_min_usd, source }]` from the
--                                   `modelUsage` of the result of `claude -p`; NULL in the runs recorded before this column, and when the result carried no counts.
ALTER TABLE execute_runs ADD COLUMN model_usage_json TEXT;
