// An in-memory SQLite database that implements the part of the D1 API that
// albireo uses. It applies the real migrations, so the tests run the Worker's
// own SQL.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { D1Database, D1PreparedStatement, D1Result } from "../../worker/env.ts";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations/", import.meta.url));

export function createTestDatabase(): D1Database {
  const db = new DatabaseSync(":memory:");
  const files = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) db.exec(readFileSync(`${MIGRATIONS_DIR}${file}`, "utf8"));
  return { prepare: (query) => statement(db, query, []) };
}

function statement(db: DatabaseSync, query: string, values: unknown[]): D1PreparedStatement {
  const params = (): SQLInputValue[] => values.map(toSqlValue);
  return {
    bind: (...next: unknown[]) => statement(db, query, next),
    first: async <T>(): Promise<T | null> => (db.prepare(query).get(...params()) as T | undefined) ?? null,
    all: async <T>(): Promise<D1Result<T>> => ({ results: db.prepare(query).all(...params()) as T[], meta: {} }),
    run: async (): Promise<D1Result<unknown>> => {
      const result = db.prepare(query).run(...params());
      return { results: [], meta: { changes: Number(result.changes) } };
    },
  };
}

// D1 binds null, numbers, and strings, and rejects undefined. The fake does the same.
function toSqlValue(value: unknown): SQLInputValue {
  if (value === null || typeof value === "number" || typeof value === "string") return value;
  throw new TypeError(`D1 cannot bind a value of type ${typeof value}.`);
}
