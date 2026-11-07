-- The language of the browser app that each person chooses on the account page, such as
-- 'en' or 'ja'. The Worker accepts only the languages that the browser app has, so that a
-- new language needs no change to the table.
ALTER TABLE users ADD COLUMN language TEXT NOT NULL DEFAULT 'en';
