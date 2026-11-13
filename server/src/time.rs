//! Times of the library. albireo writes every time to the millisecond, so that a time that a
//! cursor carries as text finds its row again.

use chrono::{DateTime, DurationRound, SecondsFormat, TimeDelta, Utc};

pub type Time = DateTime<Utc>;

/// Now, to the millisecond.
pub fn now() -> Time {
    let time = Utc::now();
    time.duration_trunc(TimeDelta::milliseconds(1)).unwrap_or(time)
}

/// A time as the API writes it, such as 2026-11-04T09:30:00.000Z.
pub fn iso(time: &Time) -> String {
    time.to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// Reads a time that the API wrote.
pub fn parse_iso(text: &str) -> Option<Time> {
    DateTime::parse_from_rfc3339(text).ok().map(|time| time.with_timezone(&Utc))
}

/// The milliseconds since 1970, for the versions in the URLs of pictures.
pub fn millis(time: &Time) -> i64 {
    time.timestamp_millis()
}
