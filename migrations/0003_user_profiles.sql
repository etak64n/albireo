-- What people write about themselves, and the picture that they choose.
ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT '';
-- The key of the picture in the bucket, or null for the default person icon.
ALTER TABLE users ADD COLUMN avatar_key TEXT;
