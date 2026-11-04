-- The videos that each person watched: one row per person and video, with the last time.
CREATE TABLE watch_history (
  user_id TEXT NOT NULL REFERENCES users (id),
  video_id TEXT NOT NULL REFERENCES videos (id),
  watched_at TEXT NOT NULL,
  PRIMARY KEY (user_id, video_id)
);

-- The history page lists the videos of one person from the last watched.
CREATE INDEX watch_history_recent ON watch_history (user_id, watched_at DESC, video_id DESC);
