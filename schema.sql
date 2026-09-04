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

CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  client_token TEXT NOT NULL,
  submission_id TEXT NOT NULL DEFAULT '',
  user_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  requester_name TEXT NOT NULL,
  requester_phone TEXT NOT NULL,
  pickup_address TEXT NOT NULL,
  pickup_lat REAL NOT NULL,
  pickup_lon REAL NOT NULL,
  ready_time TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  recipient_phone TEXT NOT NULL,
  delivery_address TEXT NOT NULL,
  delivery_lat REAL NOT NULL,
  delivery_lon REAL NOT NULL,
  service TEXT NOT NULL,
  payment TEXT NOT NULL,
  order_total REAL NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  distance_km REAL NOT NULL,
  duration_min INTEGER NOT NULL DEFAULT 0,
  route_source TEXT NOT NULL DEFAULT 'osrm-road',
  base_fee REAL NOT NULL,
  late_fee REAL NOT NULL DEFAULT 0,
  total_fee REAL NOT NULL,
  micro_delivery INTEGER NOT NULL DEFAULT 0,
  rejection_reason TEXT NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_requests_submission ON requests(submission_id) WHERE submission_id<>'';
CREATE INDEX IF NOT EXISTS idx_requests_status_created ON requests(status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_requests_created ON requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_requests_user_created ON requests(user_id,created_at DESC);
INSERT OR IGNORE INTO rider_presence(id,enabled,eta_per_job,updated_at) VALUES(1,0,25,datetime('now'));
