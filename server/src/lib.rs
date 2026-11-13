//! albireo: a private video library. The server keeps the library in PostgreSQL and the files in
//! an S3-compatible bucket, passes every file between the browser and the bucket, and serves the
//! browser app. People sign in with an email and a password; admins invite them.

pub mod api;
pub mod auth;
pub mod backup;
pub mod config;
pub mod db;
pub mod error;
pub mod ids;
pub mod json;
pub mod log;
pub mod model;
pub mod pages;
pub mod repo;
pub mod security;
pub mod shared;
pub mod storage;
pub mod storage_check;
pub mod time;
