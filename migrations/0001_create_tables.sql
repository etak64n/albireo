-- The tables of albireo. albireo has no sign-in: everyone who opens it is the one person of
-- the users table, whom albireo adds when it starts for the first time.

-- The person who uses albireo: the name, the bio, and the picture of their channel, and the
-- language of the app, such as 'en' or 'ja'. The server accepts only the languages that the
-- browser app has, so that a new language needs no change to the table.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  bio TEXT NOT NULL,
  -- The key of the picture in the bucket, or null for the default person icon.
  avatar_key TEXT,
  language TEXT NOT NULL,
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

CREATE INDEX series_updated_at ON series (updated_at DESC, id DESC);

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
  updated_at TEXT NOT NULL,
  uploader_id TEXT REFERENCES users (id),
  -- A video belongs to at most one series. series_position orders the episodes of a
  -- series, and both columns are null when the video is in no series.
  series_id TEXT REFERENCES series (id),
  series_position INTEGER,
  -- The number of ratings and their average, kept on the video, so that the list of all
  -- videos sorts by rating from an index, reading one page of videos and no ratings.
  -- RatingRepository counts them again whenever someone rates the video. rating_score is
  -- the average stars times 1000, rounded down, and 0 for a video that nobody rated.
  rating_count INTEGER NOT NULL DEFAULT 0,
  rating_score INTEGER NOT NULL DEFAULT 0,
  -- The number of comments and of attachments, which the lists of videos show on each one,
  -- kept here so that a list reads no comments or attachments. The triggers below keep them.
  comment_count INTEGER NOT NULL DEFAULT 0,
  attachment_count INTEGER NOT NULL DEFAULT 0
);

-- The library lists ready videos from the newest.
CREATE INDEX videos_status_created_at ON videos (status, created_at DESC, id DESC);
CREATE INDEX videos_uploader ON videos (uploader_id, status, created_at DESC, id DESC);
CREATE INDEX videos_series ON videos (series_id, series_position);
CREATE INDEX videos_status_rating ON videos (status, rating_score DESC, rating_count DESC, created_at DESC, id DESC);
-- Home picks videos at random: from a random place among the IDs, which are random, the next
-- ready videos in the order of their IDs (VideoRepository.sampleReady). This index holds the
-- ready videos in that order, so a pick reads about one row for each video that it returns.
CREATE INDEX videos_status_id ON videos (status, id);

-- The videos that each person watched: one row per person and video, with the last time.
CREATE TABLE watch_history (
  user_id TEXT NOT NULL REFERENCES users (id),
  video_id TEXT NOT NULL REFERENCES videos (id),
  watched_at TEXT NOT NULL,
  PRIMARY KEY (user_id, video_id)
);

-- The history page lists the videos of one person from the last watched.
CREATE INDEX watch_history_recent ON watch_history (user_id, watched_at DESC, video_id DESC);

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

-- Files that go with a video, such as its slides or notes. The bucket keeps each file
-- under attachments/<video ID>/<attachment ID>; the database keeps its name for downloads.
-- A row is 'uploading' until the browser reports that the file is in the bucket.
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

-- Playlists are the lists of videos that a person makes, such as the talks to watch again.
-- Unlike a series, a playlist holds any videos, and a video can be in any number of
-- playlists. Each row of playlist_videos puts one video in one playlist; position orders
-- the videos of a playlist, from 1 for the first one added.
CREATE TABLE playlists (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX playlists_updated_at ON playlists (updated_at DESC, id DESC);
CREATE INDEX playlists_owner ON playlists (owner_id, updated_at DESC, id DESC);

CREATE TABLE playlist_videos (
  playlist_id TEXT NOT NULL REFERENCES playlists (id),
  video_id TEXT NOT NULL REFERENCES videos (id),
  position INTEGER NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (playlist_id, video_id)
);

CREATE INDEX playlist_videos_order ON playlist_videos (playlist_id, position);
CREATE INDEX playlist_videos_by_video ON playlist_videos (video_id);

-- Search reads this copy of the title and the description of every video. The trigram
-- tokenizer indexes every run of three characters, so a query finds words inside longer
-- text, also in languages that do not put spaces between words, such as Japanese.
CREATE VIRTUAL TABLE video_search USING fts5 (video_id UNINDEXED, title, description, tokenize = 'trigram');

-- The triggers keep the copy the same as the videos table.
CREATE TRIGGER video_search_insert AFTER INSERT ON videos BEGIN
  INSERT INTO video_search (video_id, title, description) VALUES (new.id, new.title, new.description);
END;

CREATE TRIGGER video_search_update AFTER UPDATE OF title, description ON videos BEGIN
  UPDATE video_search SET title = new.title, description = new.description WHERE video_id = old.id;
END;

CREATE TRIGGER video_search_delete AFTER DELETE ON videos BEGIN
  DELETE FROM video_search WHERE video_id = old.id;
END;

-- A comment counts when it is posted and stops counting when it is deleted. An attachment
-- counts when its upload is committed, and stops counting when it is removed; an attachment
-- that still uploads does not count.
CREATE TRIGGER video_comment_count_insert AFTER INSERT ON comments BEGIN
  UPDATE videos SET comment_count = comment_count + 1 WHERE id = new.video_id;
END;

CREATE TRIGGER video_comment_count_delete AFTER DELETE ON comments BEGIN
  UPDATE videos SET comment_count = comment_count - 1 WHERE id = old.video_id;
END;

CREATE TRIGGER video_attachment_count_ready AFTER UPDATE OF status ON attachments
  WHEN new.status = 'ready' AND old.status <> 'ready' BEGIN
  UPDATE videos SET attachment_count = attachment_count + 1 WHERE id = new.video_id;
END;

CREATE TRIGGER video_attachment_count_delete AFTER DELETE ON attachments WHEN old.status = 'ready' BEGIN
  UPDATE videos SET attachment_count = attachment_count - 1 WHERE id = old.video_id;
END;
