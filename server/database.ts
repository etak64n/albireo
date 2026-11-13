// The SQLite database of albireo: one file in the data folder, which node:sqlite opens.
//
// The repositories reach the database through Database, a small interface with promises:
// prepare a statement, bind its values, and read the first row, every row, or the number
// of rows that it changed. batch runs statements as one transaction. The tests open the
// same interface on a database in memory.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";

export interface QueryResult<T> {
  results: T[];
  meta: { changes?: number };
}

export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<QueryResult<T>>;
  run(): Promise<QueryResult<unknown>>;
}

export interface Database {
  prepare(query: string): Statement;
  /** Runs the statements in order as one transaction: all of them change the database, or none. */
  batch(statements: Statement[]): Promise<QueryResult<unknown>[]>;
}

/** A database that albireo opened, with the connection to close when it stops. */
export interface OpenDatabase {
  db: Database;
  close: () => void;
}

/**
 * Opens the database file, creating it the first time, and applies the migrations that it
 * does not have yet. Write-ahead logging lets a reader see the last commit while a write runs.
 */
export function openDatabase(path: string, migrationsDir: string): OpenDatabase {
  const connection = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  connection.exec("PRAGMA journal_mode = WAL");
  migrate(connection, migrationsDir);
  return { db: wrap(connection), close: () => connection.close() };
}

/** A database in memory with every migration, for the tests. */
export function openMemoryDatabase(migrationsDir: string): Database {
  const connection = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
  migrate(connection, migrationsDir);
  return wrap(connection);
}

/**
 * Applies each migration file that the database has not had, in the order of the file names,
 * each in a transaction of its own with the row that records it. Returns the names that it applied.
 */
export function migrate(connection: DatabaseSync, migrationsDir: string): string[] {
  connection.exec("CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const applied = new Set(
    connection.prepare("SELECT name FROM migrations").all().map((row) => String(row["name"])),
  );
  const files = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
  const done: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    inTransaction(connection, () => {
      connection.exec(sql);
      connection.prepare("INSERT INTO migrations (name, applied_at) VALUES (?, ?)").run(file, new Date().toISOString());
    });
    done.push(file);
  }
  return done;
}

// A statement that keeps its query and its values until it runs. It runs synchronously
// inside, so the statements of a batch run with no other request between them.
interface PendingStatement extends Statement {
  readonly query: string;
  readonly values: readonly unknown[];
}

function wrap(connection: DatabaseSync): Database {
  // Prepared statements are kept by their text, since the repositories repeat the same few.
  const prepared = new Map<string, StatementSync>();
  const compiled = (query: string): StatementSync => {
    let statement = prepared.get(query);
    if (statement === undefined) {
      statement = connection.prepare(query);
      prepared.set(query, statement);
    }
    return statement;
  };
  const runNow = (query: string, values: readonly unknown[]): QueryResult<unknown> => {
    const result = compiled(query).run(...values.map(toSqlValue));
    return { results: [], meta: { changes: Number(result.changes) } };
  };
  const statement = (query: string, values: readonly unknown[]): PendingStatement => ({
    query,
    values,
    bind: (...next: unknown[]) => statement(query, next),
    first: async <T,>(): Promise<T | null> => (compiled(query).get(...values.map(toSqlValue)) as T | undefined) ?? null,
    all: async <T,>(): Promise<QueryResult<T>> => ({ results: compiled(query).all(...values.map(toSqlValue)) as T[], meta: {} }),
    run: async () => runNow(query, values),
  });
  return {
    prepare: (query) => statement(query, []),
    batch: async (statements) => {
      const pending = statements.map((item) => {
        if (!("query" in item && "values" in item)) throw new TypeError("A batch takes only statements of the same database.");
        return item as PendingStatement;
      });
      return inTransaction(connection, () => pending.map((item) => runNow(item.query, item.values)));
    },
  };
}

function inTransaction<T>(connection: DatabaseSync, work: () => T): T {
  connection.exec("BEGIN");
  try {
    const result = work();
    connection.exec("COMMIT");
    return result;
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
}

// The database takes null, numbers, and strings. undefined is a mistake in the caller.
function toSqlValue(value: unknown): SQLInputValue {
  if (value === null || typeof value === "number" || typeof value === "string") return value;
  throw new TypeError(`The database cannot bind a value of type ${typeof value}.`);
}
