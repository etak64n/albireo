import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { migrate, openDatabase, openMemoryDatabase } from "../server/database.ts";

const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations/", import.meta.url));

describe("migrate", () => {
  it("applies each migration once, in the order of the file names", () => {
    const dir = mkdtempSync(join(tmpdir(), "albireo-migrations-"));
    try {
      writeFileSync(join(dir, "0002_b.sql"), "INSERT INTO notes (text) VALUES ('second');");
      writeFileSync(join(dir, "0001_a.sql"), "CREATE TABLE notes (text TEXT NOT NULL);");
      const connection = new DatabaseSync(":memory:");
      expect(migrate(connection, dir)).toEqual(["0001_a.sql", "0002_b.sql"]);
      expect(migrate(connection, dir)).toEqual([]);
      expect(connection.prepare("SELECT text FROM notes").all().map((row) => row["text"])).toEqual(["second"]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("leaves no part of a migration that fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "albireo-migrations-"));
    try {
      writeFileSync(join(dir, "0001_a.sql"), "CREATE TABLE notes (text TEXT NOT NULL); INSERT INTO nowhere VALUES (1);");
      const connection = new DatabaseSync(":memory:");
      expect(() => migrate(connection, dir)).toThrow(/nowhere/);
      expect(connection.prepare("SELECT name FROM sqlite_master WHERE name = 'notes'").all()).toEqual([]);
      expect(connection.prepare("SELECT name FROM migrations").all()).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

describe("openDatabase", () => {
  it("keeps the library in its file across openings, in write-ahead logging", async () => {
    const dir = mkdtempSync(join(tmpdir(), "albireo-data-"));
    try {
      const path = join(dir, "albireo.sqlite");
      const first = openDatabase(path, MIGRATIONS_DIR);
      await first.db
        .prepare("INSERT INTO users (id, display_name, bio, avatar_key, language, created_at, updated_at) VALUES (?, 'Me', '', NULL, 'en', ?, ?)")
        .bind("user000000000001", "2026-11-04T00:00:00.000Z", "2026-11-04T00:00:00.000Z")
        .run();
      expect(await first.db.prepare("PRAGMA journal_mode").first()).toEqual({ journal_mode: "wal" });
      first.close();
      const second = openDatabase(path, MIGRATIONS_DIR);
      expect({ ...(await second.db.prepare("SELECT COUNT(*) AS n FROM users").first()) }).toEqual({ n: 1 });
      second.close();
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

describe("batch", () => {
  it("changes all of the rows or none of them", async () => {
    const db = openMemoryDatabase(MIGRATIONS_DIR);
    const insert = (id: string) =>
      db
        .prepare("INSERT INTO users (id, display_name, bio, avatar_key, language, created_at, updated_at) VALUES (?, 'Me', '', NULL, 'en', 'x', 'x')")
        .bind(id);
    await expect(db.batch([insert("a"), insert("a")])).rejects.toThrow(/UNIQUE/);
    expect({ ...(await db.prepare("SELECT COUNT(*) AS n FROM users").first()) }).toEqual({ n: 0 });
    const results = await db.batch([insert("a"), insert("b")]);
    expect(results.map((result) => result.meta.changes)).toEqual([1, 1]);
  });

  it("checks the foreign keys", async () => {
    const db = openMemoryDatabase(MIGRATIONS_DIR);
    const orphan = db.prepare("INSERT INTO series (id, title, description, owner_id, created_at, updated_at) VALUES ('s', 't', '', 'nobody', 'x', 'x')");
    await expect(orphan.run()).rejects.toThrow(/FOREIGN KEY/);
  });

  it("refuses a value that the database cannot hold", async () => {
    const db = openMemoryDatabase(MIGRATIONS_DIR);
    await expect(db.prepare("SELECT ?").bind(undefined).first()).rejects.toThrow("The database cannot bind a value of type undefined.");
  });
});
