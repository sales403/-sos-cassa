-- ESEGUI UNA SOLA VOLTA su un D1 che usa già lo schema V9.
ALTER TABLE requests ADD COLUMN user_id TEXT NOT NULL DEFAULT '';
ALTER TABLE requests ADD COLUMN micro_delivery INTEGER NOT NULL DEFAULT 0;
ALTER TABLE requests ADD COLUMN submission_id TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'client' CHECK(role IN ('client','rider')),
  display_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  pickup_address TEXT NOT NULL DEFAULT '',
  pickup_lat REAL,
  pickup_lon REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rider_presence (
  id INTEGER PRIMARY KEY CHECK(id=1),
  enabled INTEGER NOT NULL DEFAULT 0,
  eta_per_job INTEGER NOT NULL DEFAULT 25,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_requests_submission ON requests(submission_id) WHERE submission_id<>'';
CREATE INDEX IF NOT EXISTS idx_requests_user_created ON requests(user_id,created_at DESC);
INSERT OR IGNORE INTO rider_presence(id,enabled,eta_per_job,updated_at) VALUES(1,0,25,datetime('now'));
