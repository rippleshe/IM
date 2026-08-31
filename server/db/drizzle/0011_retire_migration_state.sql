-- SQLite→PostgreSQL cutover bookkeeping is no longer needed after PostgreSQL became the only runtime store.
DROP TABLE IF EXISTS "migration_state";
