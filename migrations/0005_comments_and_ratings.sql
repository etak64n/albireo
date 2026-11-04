-- What people write under a video. The video page lists them from the newest.
CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos (id),
  author_id TEXT NOT NULL REFERENCES users (id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX comments_by_video ON comments (video_id, created_at DESC, id DESC);

-- The stars that each person gave a video: one row per video and person.
CREATE TABLE ratings (
  video_id TEXT NOT NULL REFERENCES videos (id),
  user_id TEXT NOT NULL REFERENCES users (id),
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  rated_at TEXT NOT NULL,
  PRIMARY KEY (video_id, user_id)
);
