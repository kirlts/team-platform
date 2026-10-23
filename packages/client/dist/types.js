// Types of what the API returns (MASTER-SPEC §7.1 and §7.2). Field names
// are the tables' own. Where the specification does not fix the shape of the
// response, the assumption is noted and the development double server meets it.
export const CAUSES = ['invalid_key', 'no_quota', 'model_not_found', 'no_network', 'rate_limited', 'timeout', 'bad_address', 'provider_error', 'unknown'];
export const JOB_STATES = ['queued', 'running', 'done', 'failed', 'cancelled'];
