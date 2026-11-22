-- PANTaU — Cloudflare D1 schema
-- Run once (see README.md). Safe to run again: every statement uses IF NOT EXISTS.
-- All times are stored in UTC; the website shows them in Malaysia time (UTC+8).

-- Users: one row per patient (or admin). IC is stored without dashes.
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ic              TEXT    NOT NULL UNIQUE
                  CHECK (length(ic) = 12 AND ic NOT GLOB '*[^0-9]*'),
  name            TEXT    NOT NULL,
  pin_hash        TEXT    NOT NULL,   -- PBKDF2-SHA256 of the PIN (never the PIN itself)
  pin_salt        TEXT    NOT NULL,
  birth_date      TEXT    NOT NULL,   -- YYYY-MM-DD, worked out from the IC (age is calculated when shown)
  gender          TEXT    NOT NULL CHECK (gender IN ('Male', 'Female')),  -- worked out from the IC
  role            TEXT    NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    TEXT,               -- set after too many wrong PINs
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Log-in sessions. Only a hash of the session token is stored.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Readings: one row per submission. Every user's rows are separated by user_id.
-- A device that was not used stays NULL. At least one device is required.
--   Blood pressure monitor: reading 1 (required if used) and reading 2 (optional)
--   Finger clip oximeter:   spo2 + pulse
--   Blood glucose monitor:  value + unit
-- measured_at = when the first reading was taken/saved (shown on the website)
-- created_at  = when the row was submitted to the database
CREATE TABLE IF NOT EXISTS readings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  bp1_systolic  INTEGER CHECK (bp1_systolic  BETWEEN 50 AND 300),
  bp1_diastolic INTEGER CHECK (bp1_diastolic BETWEEN 30 AND 200),
  bp1_bpm       INTEGER CHECK (bp1_bpm       BETWEEN 20 AND 250),
  bp2_systolic  INTEGER CHECK (bp2_systolic  BETWEEN 50 AND 300),
  bp2_diastolic INTEGER CHECK (bp2_diastolic BETWEEN 30 AND 200),
  bp2_bpm       INTEGER CHECK (bp2_bpm       BETWEEN 20 AND 250),

  spo2          INTEGER CHECK (spo2          BETWEEN 50 AND 100),
  oximeter_bpm  INTEGER CHECK (oximeter_bpm  BETWEEN 20 AND 250),

  glucose_value REAL,
  glucose_unit  TEXT    CHECK (glucose_unit IN ('mmol/L', 'mg/dL')),

  note          TEXT    CHECK (note IS NULL OR length(note) <= 100),
  measured_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),

  CHECK ((bp1_systolic IS NULL) = (bp1_diastolic IS NULL) AND (bp1_systolic IS NULL) = (bp1_bpm IS NULL)),
  CHECK ((bp2_systolic IS NULL) = (bp2_diastolic IS NULL) AND (bp2_systolic IS NULL) = (bp2_bpm IS NULL)),
  CHECK (bp2_systolic IS NULL OR bp1_systolic IS NOT NULL),
  CHECK ((spo2 IS NULL) = (oximeter_bpm IS NULL)),
  CHECK ((glucose_value IS NULL) = (glucose_unit IS NULL)),
  CHECK (glucose_value IS NULL
         OR (glucose_unit = 'mmol/L' AND glucose_value BETWEEN 1 AND 40)
         OR (glucose_unit = 'mg/dL'  AND glucose_value BETWEEN 20 AND 720)),
  CHECK (bp1_systolic IS NOT NULL OR spo2 IS NOT NULL OR glucose_value IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_readings_user_time ON readings(user_id, measured_at DESC);
