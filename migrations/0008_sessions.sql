-- The sessions that albireo has seen: one row for each Cloudflare Access token that a
-- person used. albireo writes them as requests arrive, because it cannot read the
-- sessions that Access keeps.
CREATE TABLE sessions (
  -- The SHA-256 of the token, in hexadecimal. albireo never stores the token itself.
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  -- The browser and the operating system from the User-Agent header, or '' when albireo does not know them.
  browser TEXT NOT NULL,
  os TEXT NOT NULL,
  -- The city and the two-letter country code that Cloudflare saw on the first request, or ''.
  city TEXT NOT NULL,
  country TEXT NOT NULL,
  -- When Access issued the token, and when the token expires.
  signed_in_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  -- The last request of the session, written at most once every five minutes.
  last_seen_at TEXT NOT NULL
);

-- The account page lists the sessions of one person that have not expired.
CREATE INDEX sessions_of_user ON sessions (user_id, expires_at);
