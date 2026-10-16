ALTER TABLE users
  ADD COLUMN password_change_required BOOLEAN NOT NULL DEFAULT FALSE AFTER password_hash;
