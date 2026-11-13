//! Writes one JSON object per log line, which `docker logs` shows: the time, the level, the
//! message, the request when there is one, and fields of the event.

use serde_json::{Map, Value};

use crate::time::{iso, now};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    Info,
    Warn,
    Error,
}

tokio::task_local! {
    /// The ID of the request that the task answers, for the lines that it writes.
    pub static REQUEST_ID: String;
}

/// Writes a log line. The ID of the request comes from the task that answers it.
pub fn log(level: Level, message: &str, fields: &[(&str, Value)]) {
    let mut entry = Map::new();
    entry.insert("timestamp".into(), Value::String(iso(&now())));
    entry.insert(
        "level".into(),
        Value::String(
            match level {
                Level::Info => "INFO",
                Level::Warn => "WARN",
                Level::Error => "ERROR",
            }
            .into(),
        ),
    );
    entry.insert("message".into(), Value::String(message.into()));
    if let Ok(id) = REQUEST_ID.try_with(Clone::clone) {
        entry.insert("requestId".into(), Value::String(id));
    }
    entry.insert("service".into(), Value::String("albireo".into()));
    for (name, value) in fields {
        entry.insert((*name).into(), value.clone());
    }
    let line = Value::Object(entry).to_string();
    if level == Level::Info {
        println!("{line}");
    } else {
        eprintln!("{line}");
    }
}

/// The fields of an error, for a log line.
pub fn error_fields(error: &dyn std::error::Error) -> Vec<(&'static str, Value)> {
    let mut reasons = vec![error.to_string()];
    let mut source = error.source();
    while let Some(cause) = source {
        reasons.push(cause.to_string());
        source = cause.source();
    }
    vec![("errorMessage", Value::String(reasons.join(": ")))]
}
