USE ebs_db;

ALTER TABLE users
  ADD COLUMN full_name VARCHAR(160) NULL AFTER student_id;
