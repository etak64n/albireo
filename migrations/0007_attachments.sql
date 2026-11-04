-- Files that go with a video, such as its slides or notes. The bucket keeps each file
-- under attachments/<video ID>/<attachment ID>; D1 keeps its name for downloads. A row
-- is "uploading" from the signed upload URL until the browser reports the upload done.
CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos (id),
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('uploading', 'ready')),
  created_at TEXT NOT NULL
);

CREATE INDEX attachments_by_video ON attachments (video_id, created_at, id);
