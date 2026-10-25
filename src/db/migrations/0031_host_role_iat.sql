-- Order of the roles the host declares. Forward only.
--   members.host_role_iat  `iat` (Unix seconds) of the newest token whose role was applied. A token with a smaller `iat`
--                          does not overwrite the role: a tab holding a session older than the role change does not undo it. NULL = none yet.
ALTER TABLE members ADD COLUMN host_role_iat INTEGER;
