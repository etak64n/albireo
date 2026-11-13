//! The PostgreSQL database of albireo. Several servers can share it: each one applies the
//! migrations that the database lacks when it starts, and PostgreSQL lets one server do it at a
//! time, with a lock that the migrator of sqlx takes.

use std::time::Duration;

use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;

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
    sqlx::migrate!("../migrations").run(pool).await
}
