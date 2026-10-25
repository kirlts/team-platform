-- A deleted member keeps what they published (UD-292). Forward only; the runner opens the transaction.
--   members.removed     1 only on the single placeholder member «Miembro eliminado», the author of what a removed member
--                       published. It is inactive, has no credentials and cannot be edited or chosen.
--   retired_identities  host emails of removed members. The host ingress (IDENTITY_PROVISION=host) does not create the member
--                       again while the email is here; an active person who adds the member by hand takes it out.
ALTER TABLE members ADD COLUMN removed INTEGER NOT NULL DEFAULT 0;
CREATE TABLE retired_identities (
  email      TEXT PRIMARY KEY COLLATE NOCASE,
  retired_at INTEGER NOT NULL,
  retired_by INTEGER
);
