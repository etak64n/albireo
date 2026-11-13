// The 20 lessons of the series SQL in 20 lessons, which shows a long series in the demo.
// data.ts makes a video of each, and scripts/demo-media.ts draws its two slides: the
// title, then the query of the lesson.
import type { AttachmentFile, VideoFile } from "./media.ts";

export interface Lesson {
  /** The name of the files of the video. */
  file: VideoFile;
  id: string;
  title: string;
  /** The one idea of the lesson, under its title. */
  lead: string;
  /** The query on the second slide. */
  code: string;
  attachments?: readonly AttachmentFile[];
}

export const LESSONS_SERIES_ID = "y2cjtpne9tejnzes";

export const LESSONS: readonly Lesson[] = [
  { file: "sql-01", id: "lvk9psl1be67opd1", title: "SELECT and FROM", lead: "Name the columns, then the table.", code: "SELECT title, created_at\nFROM videos;" },
  { file: "sql-02", id: "7d27jii7e307g31n", title: "WHERE", lead: "Keep only the rows that match.", code: "SELECT title\nFROM videos\nWHERE duration_sec > 600;" },
  { file: "sql-03", id: "ie4ogaqwux3bsxsa", title: "ORDER BY", lead: "Sort the rows that come back.", code: "SELECT title, created_at\nFROM videos\nORDER BY created_at DESC;" },
  { file: "sql-04", id: "apmok21iqo2agatv", title: "LIMIT", lead: "Take the first few rows.", code: "SELECT title\nFROM videos\nORDER BY created_at DESC\nLIMIT 10;" },
  { file: "sql-05", id: "qe12wnfan1uht7at", title: "COUNT and SUM", lead: "Many rows become one number.", code: "SELECT COUNT(*), SUM(duration_sec)\nFROM videos;" },
  { file: "sql-06", id: "uc05qda8bm7i8gy2", title: "GROUP BY", lead: "One row for each group.", code: "SELECT uploader_id, COUNT(*)\nFROM videos\nGROUP BY uploader_id;" },
  { file: "sql-07", id: "rtoet0fzp8njwv5k", title: "HAVING", lead: "Keep only the groups that match.", code: "SELECT uploader_id, COUNT(*) AS uploads\nFROM videos\nGROUP BY uploader_id\nHAVING COUNT(*) >= 3;" },
  { file: "sql-08", id: "q7nuabyktp71h0yz", title: "INNER JOIN", lead: "Rows that match in both tables.", code: "SELECT v.title, p.name\nFROM videos AS v\nJOIN people AS p ON p.id = v.uploader_id;", attachments: ["lessonQuery"] },
  { file: "sql-09", id: "6zoxsqwkevwv14pg", title: "LEFT JOIN", lead: "Keep the rows without a match too.", code: "SELECT p.name, v.title\nFROM people AS p\nLEFT JOIN videos AS v ON v.uploader_id = p.id;" },
  { file: "sql-10", id: "rizcyccusalon4qt", title: "Subqueries", lead: "A query inside a query.", code: "SELECT title\nFROM videos\nWHERE duration_sec >\n  (SELECT AVG(duration_sec) FROM videos);" },
  { file: "sql-11", id: "0que3rjopg1mde33", title: "WITH", lead: "Name a step, then build on it.", code: "WITH long_videos AS (\n  SELECT * FROM videos WHERE duration_sec > 1800\n)\nSELECT COUNT(*) FROM long_videos;" },
  { file: "sql-12", id: "bffh3g8sef8kkfmy", title: "Window functions", lead: "Rank the rows, and keep every row.", code: "SELECT title,\n  RANK() OVER (ORDER BY views DESC) AS place\nFROM videos;" },
  { file: "sql-13", id: "c8xf9k94d73ulz56", title: "CASE", lead: "Pick a value by a condition.", code: "SELECT title,\n  CASE WHEN duration_sec < 60 THEN 'short'\n       ELSE 'long' END AS kind\nFROM videos;" },
  { file: "sql-14", id: "yv6cgox3p7n5fcdb", title: "NULL", lead: "A missing value needs IS NULL.", code: "SELECT title\nFROM videos\nWHERE series_id IS NULL;" },
  { file: "sql-15", id: "50zw10meg7mlyqyx", title: "COALESCE", lead: "Fall back to another value.", code: "SELECT title,\n  COALESCE(description, '') AS description\nFROM videos;" },
  { file: "sql-16", id: "qesiqar3kqcw3ro2", title: "INSERT", lead: "Add a row.", code: "INSERT INTO series (title)\nVALUES ('SQL in 20 lessons');" },
  { file: "sql-17", id: "lnmkn3ikerppok67", title: "UPDATE and DELETE", lead: "Change rows, and remove them.", code: "UPDATE videos SET title = 'Lesson 17'\nWHERE id = 'v17';\n\nDELETE FROM comments\nWHERE video_id = 'v17';" },
  { file: "sql-18", id: "bw332zy91b7pwz4u", title: "Transactions", lead: "Every step, or none of them.", code: "BEGIN;\nINSERT INTO series (title) VALUES ('SQL');\nUPDATE videos SET series_id = 1;\nCOMMIT;" },
  { file: "sql-19", id: "6i5oz1c8ymr9a4ds", title: "Indexes", lead: "Find rows without reading them all.", code: "CREATE INDEX videos_by_date\nON videos (created_at);" },
  { file: "sql-20", id: "bakmbh9gsnf0or3z", title: "EXPLAIN", lead: "See how the database runs a query.", code: "EXPLAIN QUERY PLAN\nSELECT title\nFROM videos\nWHERE created_at > '2026-01-01';" },
];
