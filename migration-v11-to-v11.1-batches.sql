-- SOS Rider V11.1 · Batch / 2 consegne, stesso ritiro
-- Il Worker crea queste tabelle anche automaticamente con IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS request_batches (
  batch_id TEXT PRIMARY KEY, submission_id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL DEFAULT '', client_token TEXT NOT NULL,
  requester_name TEXT NOT NULL, requester_phone TEXT NOT NULL, pickup_address TEXT NOT NULL, pickup_lat REAL NOT NULL, pickup_lon REAL NOT NULL,
  ready_time TEXT NOT NULL, service TEXT NOT NULL, total_distance_km REAL NOT NULL DEFAULT 0, total_duration_min INTEGER NOT NULL DEFAULT 0,
  base_fee REAL NOT NULL DEFAULT 0, extra_stop_fee REAL NOT NULL DEFAULT 3.5, late_fee REAL NOT NULL DEFAULT 0, total_fee REAL NOT NULL DEFAULT 0,
  route_order TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS request_batch_items (batch_id TEXT NOT NULL, code TEXT NOT NULL UNIQUE, stop_index INTEGER NOT NULL, fee_share REAL NOT NULL DEFAULT 0, PRIMARY KEY(batch_id,code));
CREATE INDEX IF NOT EXISTS idx_batch_items_batch_stop ON request_batch_items(batch_id,stop_index);
CREATE INDEX IF NOT EXISTS idx_batches_created ON request_batches(created_at DESC);
