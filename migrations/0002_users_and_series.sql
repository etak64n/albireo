-- People who use albireo. Cloudflare Access signs them in and reports their
-- email, and albireo adds a row the first time someone uses the API.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Series group videos as numbered episodes, such as the recordings of a course.
CREATE TABLE series (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- The uploader is null for videos that were uploaded before albireo recorded uploaders.
ALTER TABLE videos ADD COLUMN uploader_id TEXT REFERENCES users (id);
-- A video belongs to at most one series. series_position orders the episodes of a
-- series, and both columns are null when the video is in no series.
ALTER TABLE videos ADD COLUMN series_id TEXT REFERENCES series (id);
ALTER TABLE videos ADD COLUMN series_position INTEGER;

CREATE INDEX videos_uploader ON videos (uploader_id, status, created_at DESC, id DESC);
CREATE INDEX videos_series ON videos (series_id, series_position);
CREATE INDEX series_updated_at ON series (updated_at DESC, id DESC);
