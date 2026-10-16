CREATE DATABASE IF NOT EXISTS ebs_db
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE ebs_db;

CREATE TABLE IF NOT EXISTS roles (
  id TINYINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(40) NOT NULL UNIQUE
) ENGINE=InnoDB;

INSERT IGNORE INTO roles (id, name) VALUES
  (1, 'student'), (2, 'faculty'), (3, 'custodian'), (4, 'administrator');

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  role_id TINYINT UNSIGNED NOT NULL,
  student_id VARCHAR(40) NULL UNIQUE,
  full_name VARCHAR(160) NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  program VARCHAR(120) NULL,
  password_hash VARCHAR(255) NOT NULL,
  password_change_required BOOLEAN NOT NULL DEFAULT FALSE,
  email_verified_at DATETIME NULL,
  account_status ENUM('active','disabled') NOT NULL DEFAULT 'active',
  account_hold BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_student_profile CHECK (
    role_id <> 1 OR (student_id IS NOT NULL AND program IS NOT NULL AND full_name IS NOT NULL)
  ),
  CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id),
  INDEX idx_users_role_status (role_id, account_status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS auth_tokens (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  purpose ENUM('verify_email','reset_password') NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_auth_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_auth_tokens_expiry (purpose, expires_at, used_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS categories (
  id INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL UNIQUE,
  description VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS equipment (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  asset_code VARCHAR(60) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  description TEXT NULL,
  category_id INT UNSIGNED NOT NULL,
  serial_number VARCHAR(120) NULL UNIQUE,
  qr_code VARCHAR(200) NOT NULL UNIQUE,
  image_path VARCHAR(500) NULL,
  image_mime VARCHAR(80) NULL,
  image_data MEDIUMBLOB NULL,
  quantity SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  location VARCHAR(180) NOT NULL,
  status ENUM('Available','Reserved','Checked Out','Under Maintenance','Lost')
    NOT NULL DEFAULT 'Available',
  archived_at DATETIME NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_equipment_quantity CHECK (quantity > 0),
  CONSTRAINT fk_equipment_category FOREIGN KEY (category_id) REFERENCES categories(id),
  CONSTRAINT fk_equipment_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_equipment_catalog (archived_at, category_id, status, name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS reservations (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  reservation_code CHAR(36) NOT NULL UNIQUE,
  equipment_id BIGINT UNSIGNED NOT NULL,
  borrower_id BIGINT UNSIGNED NOT NULL,
  pickup_at DATETIME NOT NULL,
  due_at DATETIME NOT NULL,
  purpose VARCHAR(500) NOT NULL,
  status ENUM('pending','approved','checked_out','completed','cancelled','rejected','overdue')
    NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_reservation_dates CHECK (due_at > pickup_at),
  CONSTRAINT fk_reservations_equipment FOREIGN KEY (equipment_id) REFERENCES equipment(id),
  CONSTRAINT fk_reservations_borrower FOREIGN KEY (borrower_id) REFERENCES users(id),
  INDEX idx_reservations_schedule (equipment_id, status, pickup_at, due_at),
  INDEX idx_reservations_borrower (borrower_id, status, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS borrow_transactions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  reservation_id BIGINT UNSIGNED NOT NULL UNIQUE,
  equipment_id BIGINT UNSIGNED NOT NULL,
  borrower_id BIGINT UNSIGNED NOT NULL,
  processed_by BIGINT UNSIGNED NOT NULL,
  checked_out_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  due_at DATETIME NOT NULL,
  returned_at DATETIME NULL,
  status ENUM('active','returned','overdue','lost') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_borrow_reservation FOREIGN KEY (reservation_id) REFERENCES reservations(id),
  CONSTRAINT fk_borrow_equipment FOREIGN KEY (equipment_id) REFERENCES equipment(id),
  CONSTRAINT fk_borrow_borrower FOREIGN KEY (borrower_id) REFERENCES users(id),
  CONSTRAINT fk_borrow_processor FOREIGN KEY (processed_by) REFERENCES users(id),
  INDEX idx_borrow_due_status (status, due_at),
  INDEX idx_borrow_equipment_active (equipment_id, status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS returns (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  transaction_id BIGINT UNSIGNED NOT NULL UNIQUE,
  processed_by BIGINT UNSIGNED NOT NULL,
  condition_status ENUM('Good','Damaged','Missing Parts') NOT NULL,
  notes TEXT NULL,
  photo_path VARCHAR(500) NULL,
  photo_data LONGBLOB NULL,
  returned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_returns_transaction FOREIGN KEY (transaction_id) REFERENCES borrow_transactions(id),
  CONSTRAINT fk_returns_processor FOREIGN KEY (processed_by) REFERENCES users(id),
  CONSTRAINT chk_return_condition_notes CHECK (
    condition_status = 'Good' OR
    (notes IS NOT NULL AND CHAR_LENGTH(TRIM(notes)) > 0 AND photo_data IS NOT NULL)
  )
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS damage_reports (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  return_id BIGINT UNSIGNED NOT NULL UNIQUE,
  equipment_id BIGINT UNSIGNED NOT NULL,
  borrower_id BIGINT UNSIGNED NOT NULL,
  notes TEXT NOT NULL,
  photo_path VARCHAR(500) NOT NULL,
  status ENUM('open','reviewing','resolved') NOT NULL DEFAULT 'open',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_damage_return FOREIGN KEY (return_id) REFERENCES returns(id),
  CONSTRAINT fk_damage_equipment FOREIGN KEY (equipment_id) REFERENCES equipment(id),
  CONSTRAINT fk_damage_borrower FOREIGN KEY (borrower_id) REFERENCES users(id),
  INDEX idx_damage_status_date (status, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  type VARCHAR(60) NOT NULL,
  subject VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  reference_id VARCHAR(80) NULL,
  sent_at DATETIME NULL,
  read_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_notification_reference (user_id, type, reference_id),
  INDEX idx_notifications_user_unread (user_id, read_at, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  actor_id BIGINT UNSIGNED NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id VARCHAR(80) NULL,
  details JSON NULL,
  ip_address VARCHAR(45) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_audit_entity (entity_type, entity_id, created_at),
  INDEX idx_audit_actor_date (actor_id, created_at)
) ENGINE=InnoDB;
