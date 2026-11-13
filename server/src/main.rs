//! Starts albireo in its container, with one of these commands.
//!
//! serve, the command of the image: reads the settings from the environment, connects to the
//! database and applies its migrations, checks the bucket, and serves the browser app and the API
//! on port 8080. A wrong setting stops albireo before it serves anything, with an instruction in
//! the log that starts with "Please".
//!
//! healthcheck: asks the albireo of this container whether it answers, for the health check of Docker.
//!
//! backup: writes a copy of the database to the bucket, under backups/, and exits.
//!
//! restore <key>: loads the copy of the key into an empty database, and exits.

use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

use albireo::api::{AppState, router};
use albireo::auth;
use albireo::backup::{self, BackupError};
use albireo::config::{Config, read_config};
use albireo::db;
use albireo::ids::random_id;
use albireo::log::{Level, error_fields, log};
use albireo::pages::Pages;
use albireo::repo::people;
use albireo::storage::S3ObjectStore;
use albireo::storage_check::{check_storage, may_pass_later, problem_message};
use albireo::time::now;
use serde_json::Value;
use sqlx::PgPool;

const PORT: u16 = 8080;
// While the database or the bucket does not answer, as when it starts with albireo, albireo tries
// again after these waits, in seconds, and stops after the last one.
const RETRY_WAITS: [u64; 5] = [2, 4, 8, 16, 30];
// When it is asked to stop, albireo lets the requests that run finish for this long, then exits.
// Docker stops a container 10 seconds after it asks it to stop.
const STOP_WAIT: Duration = Duration::from_secs(5);

fn stop(message: &str, fields: &[(&str, Value)]) -> ExitCode {
    log(Level::Error, message, fields);
    ExitCode::FAILURE
}

#[tokio::main]
async fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.iter().map(String::as_str).collect::<Vec<_>>().as_slice() {
        ["serve"] => serve().await,
        ["healthcheck"] => healthcheck().await,
        ["backup"] => write_backup().await,
        ["restore", key] => restore(key).await,
        ["restore"] => stop(
            "Please name the copy to restore after the command, such as albireo restore backups/albireo-20261114T031500Z.sql.gz.",
            &[],
        ),
        _ => stop(
            &format!(
                "Please run albireo with one of the commands serve, which the image runs by default, healthcheck, backup, and restore <key>. It got {args:?}."
            ),
            &[],
        ),
    }
}

/// The settings, or None after albireo logged what is wrong with them.
fn settings() -> Option<Config> {
    match read_config(|name| std::env::var(name).ok()) {
        Ok(config) => Some(config),
        Err(problems) => {
            for problem in problems {
                log(Level::Error, &problem, &[]);
            }
            None
        }
    }
}

/// Connects to the database of the settings, and applies the migrations that it lacks.
async fn open_database(config: &Config) -> Result<PgPool, ExitCode> {
    let mut attempt = 0;
    let pool = loop {
        match db::connect(&config.database_url).await {
            Ok(pool) => break pool,
            // A database that does not answer yet may answer later. A wrong password or the
            // name of a database that does not exist stays wrong, so albireo stops at once.
            Err(error @ (sqlx::Error::Io(_) | sqlx::Error::PoolTimedOut)) if attempt < RETRY_WAITS.len() => {
                let wait = RETRY_WAITS[attempt];
                let mut fields = error_fields(&error);
                fields.push(("waitSeconds", Value::from(wait)));
                log(Level::Warn, "The database did not answer. albireo tries again.", &fields);
                tokio::time::sleep(Duration::from_secs(wait)).await;
                attempt += 1;
            }
            Err(error) => {
                return Err(stop(
                    "Please check DATABASE_URL: albireo could not connect to the database with it. The reason is in errorMessage.",
                    &error_fields(&error),
                ));
            }
        }
    };
    if let Err(error) = db::migrate(&pool).await {
        return Err(stop(
            "Please give the user of DATABASE_URL permission to create tables and the extension pg_trgm in its database. albireo could not prepare its tables.",
            &error_fields(&error),
        ));
    }
    Ok(pool)
}

fn open_bucket(config: &Config) -> Result<Arc<S3ObjectStore>, ExitCode> {
    S3ObjectStore::new(&config.storage)
        .map(Arc::new)
        .map_err(|error| stop(&format!("Please check S3_ENDPOINT and S3_BUCKET. {}", error.message), &[]))
}

async fn serve() -> ExitCode {
    let Some(config) = settings() else { return ExitCode::FAILURE };
    let pool = match open_database(&config).await {
        Ok(pool) => pool,
        Err(code) => return code,
    };

    let store = match open_bucket(&config) {
        Ok(store) => store,
        Err(code) => return code,
    };
    let mut attempt = 0;
    loop {
        match check_storage(store.as_ref(), &random_id()).await {
            None => break,
            Some(problem) if may_pass_later(&problem) && attempt < RETRY_WAITS.len() => {
                let wait = RETRY_WAITS[attempt];
                log(
                    Level::Warn,
                    "The bucket did not answer. albireo tries again.",
                    &[("waitSeconds", Value::from(wait))],
                );
                tokio::time::sleep(Duration::from_secs(wait)).await;
                attempt += 1;
            }
            Some(problem) => return stop(&problem_message(&problem, &config.storage.bucket), &[]),
        }
    }

    match auth::new_setup_code(&pool, now()).await {
        Ok(Some(code)) => log(
            Level::Info,
            "albireo has nobody yet. Open albireo in a browser, and create the first admin with the setup code.",
            &[("setupCode", Value::String(code))],
        ),
        Ok(None) => {}
        Err(error) => return stop("albireo could not write a setup code to the database.", &error_fields(&error)),
    }

    let pages = match Pages::load(std::path::Path::new("dist")) {
        Ok(pages) => Arc::new(pages),
        Err(error) => return stop("albireo found no browser app in dist/.", &error_fields(&error)),
    };
    let app = router(AppState {
        db: pool.clone(),
        store,
        pages,
    });

    let listener = match tokio::net::TcpListener::bind(("0.0.0.0", PORT)).await {
        Ok(listener) => listener,
        Err(error) => return stop(&format!("albireo could not listen on port {PORT}."), &error_fields(&error)),
    };

    // Forgets the sessions that have expired, once an hour.
    let cleaner = pool.clone();
    tokio::spawn(async move {
        loop {
            if let Err(error) = people::delete_expired_sessions(&cleaner, now()).await {
                log(Level::Warn, "Could not forget the expired sessions.", &error_fields(&error));
            }
            tokio::time::sleep(Duration::from_secs(60 * 60)).await;
        }
    });

    let version = env!("CARGO_PKG_VERSION");
    log(
        Level::Info,
        &format!("albireo {version} is ready on port {PORT}"),
        &[
            ("version", Value::from(version)),
            ("bucket", Value::from(config.storage.bucket.clone())),
            ("endpoint", Value::from(config.storage.endpoint.clone())),
        ],
    );

    let (stopping, stopped) = tokio::sync::oneshot::channel::<()>();
    let server = tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                stopped.await.ok();
            })
            .await
    });
    let signal = shutdown_signal().await;
    log(Level::Info, "albireo is stopping", &[("signal", Value::from(signal))]);
    let _ = stopping.send(());
    if tokio::time::timeout(STOP_WAIT, server).await.is_err() {
        log(Level::Info, "albireo ended the requests that were still running", &[]);
    }
    pool.close().await;
    ExitCode::SUCCESS
}

/// Writes a copy of the database to the bucket. The copy needs no more of the database than a
/// read, and runs beside the servers.
async fn write_backup() -> ExitCode {
    let Some(config) = settings() else { return ExitCode::FAILURE };
    let pool = match connect_only(&config).await {
        Ok(pool) => pool,
        Err(code) => return code,
    };
    let store = match open_bucket(&config) {
        Ok(store) => store,
        Err(code) => return code,
    };
    match backup::write_copy(&pool, store.as_ref(), now()).await {
        Ok(copy) => {
            log(
                Level::Info,
                "Wrote a copy of the database to the bucket",
                &[
                    ("key", Value::String(copy.key)),
                    ("bytes", Value::from(copy.bytes)),
                    ("rows", Value::from(copy.rows)),
                ],
            );
            ExitCode::SUCCESS
        }
        Err(error) => stop_for(
            error,
            &format!(
                "Please check that the access key in S3_ACCESS_KEY_ID can write objects to the bucket {}: albireo could not write the copy. The reason is in errorMessage.",
                config.storage.bucket
            ),
        ),
    }
}

/// Loads a copy from the bucket into an empty database, after its migrations.
async fn restore(key: &str) -> ExitCode {
    let Some(config) = settings() else { return ExitCode::FAILURE };
    let pool = match open_database(&config).await {
        Ok(pool) => pool,
        Err(code) => return code,
    };
    let store = match open_bucket(&config) {
        Ok(store) => store,
        Err(code) => return code,
    };
    match backup::restore_copy(&pool, store.as_ref(), key).await {
        Ok(restored) => {
            log(
                Level::Info,
                "Restored the copy of the database",
                &[
                    ("key", Value::String(key.into())),
                    ("tables", Value::from(restored.tables)),
                    ("rows", Value::from(restored.rows)),
                ],
            );
            ExitCode::SUCCESS
        }
        Err(error) => stop_for(
            error,
            &format!(
                "Please check that the access key in S3_ACCESS_KEY_ID can read the objects of the bucket {}: albireo could not read the copy. The reason is in errorMessage.",
                config.storage.bucket
            ),
        ),
    }
}

/// Connects to the database without applying migrations: a copy must not change the database
/// that the servers use.
async fn connect_only(config: &Config) -> Result<PgPool, ExitCode> {
    db::connect(&config.database_url).await.map_err(|error| {
        stop(
            "Please check DATABASE_URL: albireo could not connect to the database with it. The reason is in errorMessage.",
            &error_fields(&error),
        )
    })
}

/// Stops with the instruction of a refusal, or with the message for a failure of the bucket.
fn stop_for(error: BackupError, storage_message: &str) -> ExitCode {
    match error {
        BackupError::Refused(message) => stop(&message, &[]),
        BackupError::Storage(error) => stop(storage_message, &error_fields(&error)),
        BackupError::Database(error) => stop(
            "albireo could not finish the work in the database. The reason is in errorMessage.",
            &error_fields(&error),
        ),
        BackupError::Io(error) => stop(
            "albireo could not use the folder of temporary files. The reason is in errorMessage.",
            &error_fields(&error),
        ),
    }
}

async fn shutdown_signal() -> &'static str {
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };
    tokio::select! {
        _ = tokio::signal::ctrl_c() => "SIGINT",
        () = terminate => "SIGTERM",
    }
}

async fn healthcheck() -> ExitCode {
    let client = reqwest::Client::builder().timeout(Duration::from_secs(5)).build();
    let healthy = match client {
        Ok(client) => client
            .get(format!("http://127.0.0.1:{PORT}/healthz"))
            .send()
            .await
            .is_ok_and(|response| response.status().is_success()),
        Err(_) => false,
    };
    if healthy { ExitCode::SUCCESS } else { ExitCode::FAILURE }
}
