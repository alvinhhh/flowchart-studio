import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { DatabaseResult, DatabaseStatement, MetricsDatabase } from './metrics';

class SqliteStatement implements DatabaseStatement {
  constructor(private db: DatabaseSync, private sql: string, private values: (string | number | null)[] = []) {}
  bind(...values: (string | number | null)[]) { return new SqliteStatement(this.db, this.sql, values); }
  async first<T>() { return (this.db.prepare(this.sql).get(...this.values) as T | undefined) ?? null; }
  async all<T>(): Promise<DatabaseResult<T>> { return { results: this.db.prepare(this.sql).all(...this.values) as T[] }; }
  execute() { return this.db.prepare(this.sql).run(...this.values); }
  async run() { return this.execute(); }
}

/** Runs production SQL against real SQLite, including transactional D1 batch behavior. */
export function testDatabase(): MetricsDatabase & { sqlite: DatabaseSync; close(): void } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../migrations/0001_metrics.sql', import.meta.url), 'utf8'));
  return {
    sqlite,
    prepare(sql: string) { return new SqliteStatement(sqlite, sql); },
    async batch(statements: DatabaseStatement[]) {
      sqlite.exec('BEGIN');
      try {
        const result = statements.map(statement => (statement as SqliteStatement).execute());
        sqlite.exec('COMMIT');
        return result;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
    close() { sqlite.close(); },
  };
}
