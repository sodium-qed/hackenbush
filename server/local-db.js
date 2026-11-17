import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

// A small D1-compatible adapter lets the HTTP server, tests and deployed Worker
// execute the same queries. Batches run synchronously within one transaction.
export function openArenaDB(path = ':memory:') {
  const database = new DatabaseSync(path);
  database.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
  database.exec('CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)');
  const directory = new URL('../drizzle/', import.meta.url);
  for (const name of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) {
    database.exec('BEGIN IMMEDIATE');
    try {
      if (!database.prepare('SELECT 1 FROM local_migrations WHERE name = ?').get(name)) {
        database.exec(readFileSync(new URL(name, directory), 'utf8'));
        database.prepare('INSERT INTO local_migrations (name) VALUES (?)').run(name);
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      database.close();
      throw error;
    }
  }

  function prepared(query, values = []) {
    function execute() {
      const results = database.prepare(query).all(...values);
      const meta = database.prepare('SELECT changes() AS changes, last_insert_rowid() AS last_row_id').get();
      return { success: true, results, meta };
    }
    return {
      bind: (...params) => prepared(query, params),
      async first(column) {
        const row = database.prepare(query).get(...values);
        if (row === undefined) return null;
        return column === undefined ? row : row[column];
      },
      async all() { return execute(); },
      async run() { return execute(); },
      execute
    };
  }
  return {
    prepare: prepared,
    async batch(statements) {
      database.exec('BEGIN IMMEDIATE');
      try {
        const result = statements.map(statement => statement.execute());
        database.exec('COMMIT');
        return result;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
    close() { database.close(); }
  };
}
