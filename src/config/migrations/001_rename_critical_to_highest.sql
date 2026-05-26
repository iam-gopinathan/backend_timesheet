-- Migration: rename the 'critical' priority value to 'highest'.
-- Apply this once on the production database (e.g. via Neon SQL editor) AFTER
-- merging the PR -- fresh installs already pick this up from schema.sql.
--
-- Safe: ALTER TYPE ... RENAME VALUE keeps all existing rows pointing at the
-- same enum constant; only the label changes.

ALTER TYPE task_priority RENAME VALUE 'critical' TO 'highest';
