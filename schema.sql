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

-- Readings: blood pressure monitor + finger clip oximeter.
-- created_at is filled in automatically by the database.
CREATE TABLE IF NOT EXISTS readings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  systolic     INTEGER NOT NULL CHECK (systolic     BETWEEN 50 AND 300),
  diastolic    INTEGER NOT NULL CHECK (diastolic    BETWEEN 30 AND 200),
  bp_bpm       INTEGER NOT NULL CHECK (bp_bpm       BETWEEN 20 AND 250),  -- BPM from the BP monitor
  spo2         INTEGER NOT NULL CHECK (spo2         BETWEEN 50 AND 100),
  oximeter_bpm INTEGER NOT NULL CHECK (oximeter_bpm BETWEEN 20 AND 250),  -- pulse from the oximeter
  note         TEXT    CHECK (note IS NULL OR length(note) <= 100),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_readings_user_time ON readings(user_id, created_at DESC);
