-- cf-share: add optional password protection to shares
-- Run after 0001_initial.sql

ALTER TABLE shares ADD COLUMN password_hash TEXT;
ALTER TABLE shares ADD COLUMN password_salt TEXT;
