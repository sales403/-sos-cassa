-- SOS Rider V11 Dispatch Core
-- Idempotent: safe to execute more than once.

CREATE TABLE IF NOT EXISTS rider_location (
  id INTEGER PRIMARY KEY CHECK(id=1),
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  accuracy_m REAL,
  speed_mps REAL,
  heading_deg REAL,
  source TEXT NOT NULL DEFAULT 'pwa',
  captured_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS request_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status_from TEXT NOT NULL DEFAULT '',
  status_to TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'system',
  payload_json TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_request_events_code_created
  ON request_events(code, created_at DESC);

CREATE TABLE IF NOT EXISTS request_sources (
  code TEXT PRIMARY KEY,
  channel TEXT NOT NULL DEFAULT 'app',
  external_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_request_sources_channel
  ON request_sources(channel, created_at DESC);
