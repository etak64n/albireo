//! The PostgreSQL database of albireo. Several servers can share it: each one applies the
//! migrations that the database lacks when it starts, and PostgreSQL lets one server do it at a
//! time, with a lock that the migrator of sqlx takes.

use std::time::Duration;

use sqlx::migrate::Migrator;
use sqlx::postgres::PgPoolOptions;
use sqlx::{PgPool, Postgres, Transaction};

/// The migrations of migrations/, which go into the program as it builds.
pub static MIGRATOR: Migrator = sqlx::migrate!("../migrations");

/// Opens a pool of connections to the database.
pub async fn connect(url: &str) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(10)
        .acquire_timeout(Duration::from_secs(10))
        .connect(url)
        .await
}

/// Applies the migrations of migrations/ that the database does not have yet.
pub async fn migrate(pool: &PgPool) -> Result<(), sqlx::migrate::MigrateError> {
    MIGRATOR.run(pool).await
}

/// The versions of the migrations that this albireo knows, in order.
pub fn known_migrations() -> Vec<i64> {
    MIGRATOR
        .iter()
        .filter(|migration| !migration.migration_type.is_down_migration())
        .map(|migration| migration.version)
        .collect()
}

/// The versions of the migrations that the database has, in order.
pub async fn applied_migrations(transaction: &mut Transaction<'_, Postgres>) -> Result<Vec<i64>, sqlx::Error> {
    sqlx::query_scalar("SELECT version FROM _sqlx_migrations WHERE success ORDER BY version")
        .fetch_all(&mut **transaction)
        .await
}
