-- The tables of albireo in PostgreSQL.
--
-- Every time is a timestamptz that albireo writes to the millisecond, so that the cursors of
-- the lists, which carry times as text, find their rows again. IDs are 16 random digits and
-- lowercase letters, which albireo makes.

-- Search finds words inside titles and descriptions with trigram indexes, also in languages
-- that do not put spaces between words, such as Japanese.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- The people who use albireo. The first admin comes from the setup, and everyone else from an
-- invitation. A person whom an admin removed keeps their videos and comments, and cannot sign in.
CREATE TABLE users (
  id text PRIMARY KEY,
  -- In lowercase. Each person signs in with their email and their password.
  email text NOT NULL UNIQUE,
  -- Argon2id, in the PHC string format.
  password_hash text NOT NULL,
  display_name text NOT NULL,
  bio text NOT NULL,
  -- The key of the picture in the bucket, or null for the default person icon.
  avatar_key text,
  -- The language of the browser app, such as 'en' or 'ja'. The server accepts only the
  -- languages that the browser app has, so that a new language needs no change to the table.
  language text NOT NULL,
  -- Admins edit everything, and invite and remove people.
  is_admin boolean NOT NULL,
  -- Sign-ins with a wrong password in a row. Too many lock the account for a while.
  failed_sign_ins integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  removed_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

-- One row for each browser where a person signed in. The ID is the SHA-256 of the token of
-- the cookie, so the table never holds a token.
CREATE TABLE sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users (id),
  -- The browser and the operating system from the User-Agent header, or '' when albireo does not know them.
  browser text NOT NULL,
  os text NOT NULL,
  created_at timestamptz NOT NULL,
  -- The last request of the session, written at most once every five minutes.
  last_seen_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE INDEX sessions_of_user ON sessions (user_id, expires_at);

-- Invitations that nobody has used yet. albireo deletes one when someone joins with it.
CREATE TABLE invitations (
  id text PRIMARY KEY,
  -- The SHA-256 of the token of the link.
  token_hash text NOT NULL UNIQUE,
  is_admin boolean NOT NULL,
  invited_by text NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

-- While albireo has nobody, each server writes a setup code to its log and its SHA-256 here, so
-- that the code of any server works with every server. The setup deletes them all.
CREATE TABLE setup_codes (
  code_hash text PRIMARY KEY,
  created_at timestamptz NOT NULL
);

-- Series group videos as numbered episodes, such as the recordings of a course.
CREATE TABLE series (
  id text PRIMARY KEY,
  title text NOT NULL,
  description text NOT NULL,
  owner_id text NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX series_updated_at ON series (updated_at DESC, id DESC);
CREATE INDEX series_owner ON series (owner_id, updated_at DESC, id DESC);

-- Videos that albireo knows about. A row starts as 'uploading' when the browser begins a
-- multipart upload, and becomes 'ready' when the upload completes. A canceled upload deletes its row.
CREATE TABLE videos (
  id text PRIMARY KEY,
  title text NOT NULL,
  description text NOT NULL,
  status text NOT NULL CHECK (status IN ('uploading', 'ready')),
  object_key text NOT NULL,
  upload_id text,
  content_type text NOT NULL,
  file_size bigint NOT NULL,
  part_size bigint NOT NULL,
  part_count integer NOT NULL,
  duration_sec double precision,
  width integer,
  height integer,
  thumbnail_key text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  uploader_id text REFERENCES users (id),
  -- A video belongs to at most one series. series_position orders the episodes of a series,
  -- and both columns are null when the video is in no series.
  series_id text REFERENCES series (id),
  series_position integer,
  -- The number of ratings and their average times 1000, rounded down, kept on the video, so
  -- that the list of all videos sorts by rating from an index. The server counts them again
  -- whenever someone rates the video.
  rating_count integer NOT NULL DEFAULT 0,
  rating_score integer NOT NULL DEFAULT 0,
  -- The numbers of comments and of attachments, which the lists show on each video, kept here
  -- so that a list reads no comments or attachments. The triggers below keep them.
  comment_count integer NOT NULL DEFAULT 0,
  attachment_count integer NOT NULL DEFAULT 0
);

-- The library lists ready videos from the newest, the videos of one person from the newest,
-- the episodes of a series in their order, and the videos from the highest rated.
CREATE INDEX videos_status_created_at ON videos (status, created_at DESC, id DESC);
CREATE INDEX videos_uploader ON videos (uploader_id, status, created_at DESC, id DESC);
CREATE INDEX videos_series ON videos (series_id, series_position);
CREATE INDEX videos_status_rating ON videos (status, rating_score DESC, rating_count DESC, created_at DESC, id DESC);
-- Home picks videos at random: from a random place among the IDs, which are random, the next
-- ready videos in the order of their IDs.
CREATE INDEX videos_status_id ON videos (status, id);
-- Search looks up each word of three or more characters in the titles and the descriptions.
CREATE INDEX videos_title_trigrams ON videos USING gin (title gin_trgm_ops);
CREATE INDEX videos_description_trigrams ON videos USING gin (description gin_trgm_ops);

-- The videos that each person watched: one row per person and video, with the last time.
CREATE TABLE watch_history (
  user_id text NOT NULL REFERENCES users (id),
  video_id text NOT NULL REFERENCES videos (id),
  watched_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, video_id)
);

CREATE INDEX watch_history_recent ON watch_history (user_id, watched_at DESC, video_id DESC);
CREATE INDEX watch_history_by_video ON watch_history (video_id);

-- What people write under a video. The video page lists them from the newest.
CREATE TABLE comments (
  id text PRIMARY KEY,
  video_id text NOT NULL REFERENCES videos (id),
  author_id text NOT NULL REFERENCES users (id),
  body text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX comments_by_video ON comments (video_id, created_at DESC, id DESC);

-- The stars that each person gave a video: one row per video and person.
CREATE TABLE ratings (
  video_id text NOT NULL REFERENCES videos (id),
  user_id text NOT NULL REFERENCES users (id),
  stars integer NOT NULL CHECK (stars BETWEEN 1 AND 5),
  rated_at timestamptz NOT NULL,
  PRIMARY KEY (video_id, user_id)
);

-- Files that go with a video, such as its slides or notes. The bucket keeps each file under
-- attachments/<video ID>/<attachment ID>, and this table keeps its name for downloads. A row is
-- 'uploading' until the browser reports that the file is in the bucket.
CREATE TABLE attachments (
  id text PRIMARY KEY,
  video_id text NOT NULL REFERENCES videos (id),
  file_name text NOT NULL,
  content_type text NOT NULL,
  file_size bigint NOT NULL,
  status text NOT NULL CHECK (status IN ('uploading', 'ready')),
  created_at timestamptz NOT NULL
);

CREATE INDEX attachments_by_video ON attachments (video_id, created_at, id);

-- Playlists are the lists of videos that a person makes, such as the talks to watch again.
-- Unlike a series, a playlist holds anyone's videos, and a video can be in any number of
-- playlists. Each row of playlist_videos puts one video in one playlist; position orders the
-- videos of a playlist, from 1 for the first one added.
CREATE TABLE playlists (
  id text PRIMARY KEY,
  title text NOT NULL,
  description text NOT NULL,
  owner_id text NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX playlists_updated_at ON playlists (updated_at DESC, id DESC);
CREATE INDEX playlists_owner ON playlists (owner_id, updated_at DESC, id DESC);

CREATE TABLE playlist_videos (
  playlist_id text NOT NULL REFERENCES playlists (id),
  video_id text NOT NULL REFERENCES videos (id),
  position integer NOT NULL,
  added_at timestamptz NOT NULL,
  PRIMARY KEY (playlist_id, video_id)
);

CREATE INDEX playlist_videos_order ON playlist_videos (playlist_id, position);
CREATE INDEX playlist_videos_by_video ON playlist_videos (video_id);

-- A comment counts when it is posted and stops counting when it is deleted.
CREATE FUNCTION count_comments() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE videos SET comment_count = comment_count + 1 WHERE id = NEW.video_id;
    RETURN NEW;
  END IF;
  UPDATE videos SET comment_count = comment_count - 1 WHERE id = OLD.video_id;
  RETURN OLD;
END
$$;

CREATE TRIGGER video_comment_count AFTER INSERT OR DELETE ON comments
  FOR EACH ROW EXECUTE FUNCTION count_comments();

-- An attachment counts when its upload is committed, and stops counting when it is removed;
-- an attachment that still uploads does not count.
CREATE FUNCTION count_attachments() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    UPDATE videos SET attachment_count = attachment_count + 1 WHERE id = NEW.video_id;
    RETURN NEW;
  END IF;
  UPDATE videos SET attachment_count = attachment_count - 1 WHERE id = OLD.video_id;
  RETURN OLD;
END
$$;

CREATE TRIGGER video_attachment_count_ready AFTER UPDATE OF status ON attachments
  FOR EACH ROW WHEN (NEW.status = 'ready' AND OLD.status <> 'ready') EXECUTE FUNCTION count_attachments();

CREATE TRIGGER video_attachment_count_delete AFTER DELETE ON attachments
  FOR EACH ROW WHEN (OLD.status = 'ready') EXECUTE FUNCTION count_attachments();
