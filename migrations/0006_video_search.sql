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

-- The videos that exist before this migration.
INSERT INTO video_search (video_id, title, description) SELECT id, title, description FROM videos;
