-- Videos that albireo knows about.
-- A row starts as 'uploading' when the browser begins a multipart upload and
-- becomes 'ready' when the upload completes. A canceled upload deletes its row.
CREATE TABLE videos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('uploading', 'ready')),
  object_key TEXT NOT NULL,
  upload_id TEXT,
  content_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  part_size INTEGER NOT NULL,
  part_count INTEGER NOT NULL,
  duration_sec REAL,
  width INTEGER,
  height INTEGER,
  thumbnail_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- The library lists ready videos from the newest.
CREATE INDEX videos_status_created_at ON videos (status, created_at DESC, id DESC);
