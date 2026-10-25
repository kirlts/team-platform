-- Orden de los roles que declara el anfitrión. Forward only.
--   members.host_role_iat  `iat` (segundos Unix) del token más nuevo cuyo rol se aplicó. Un token con `iat` menor no
--                          pisa el rol: una pestaña con una sesión anterior al cambio de rol no lo deshace. NULL = ninguno aún.
ALTER TABLE members ADD COLUMN host_role_iat INTEGER;
