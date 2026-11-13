//! Readers for JSON request bodies. They reject missing, mistyped, and unknown fields instead of
//! guessing, so a client bug surfaces as a 400 response with a reason. Lengths count UTF-16 code
//! units, as the browser app does.

use serde_json::{Map, Value};

use crate::error::ApiError;
use crate::ids::is_id;

pub type JsonObject = Map<String, Value>;

/// Reads the body as a JSON object with only the given fields.
pub fn read_object(body: &[u8], fields: &[&str]) -> Result<JsonObject, ApiError> {
    let value: Value = serde_json::from_slice(body).map_err(|_| ApiError::bad_request("The request body must be JSON."))?;
    let Value::Object(object) = value else {
        return Err(ApiError::bad_request("The request body must be a JSON object."));
    };
    let unknown: Vec<&str> = object.keys().map(String::as_str).filter(|key| !fields.contains(key)).collect();
    if !unknown.is_empty() {
        return Err(ApiError::bad_request(format!(
            "The request body has unknown fields: {}.",
            unknown.join(", ")
        )));
    }
    Ok(object)
}

/// The length of the text as the browser counts it.
pub fn text_length(text: &str) -> usize {
    text.encode_utf16().count()
}

pub struct Rule {
    pub min: usize,
    pub max: usize,
    pub trim: bool,
}

pub fn read_string(body: &JsonObject, name: &str, rule: Rule) -> Result<String, ApiError> {
    match body.get(name) {
        None => Err(ApiError::bad_request(format!("{name} is required."))),
        Some(value) => check_string(value, name, &rule),
    }
}

/// Returns None when the field is absent.
pub fn read_optional_string(body: &JsonObject, name: &str, rule: Rule) -> Result<Option<String>, ApiError> {
    body.get(name).map(|value| check_string(value, name, &rule)).transpose()
}

fn check_string(value: &Value, name: &str, rule: &Rule) -> Result<String, ApiError> {
    let Value::String(text) = value else {
        return Err(ApiError::bad_request(format!("{name} must be a string.")));
    };
    let text = if rule.trim { text.trim().to_string() } else { text.clone() };
    let length = text_length(&text);
    if length < rule.min || length > rule.max {
        return Err(ApiError::bad_request(format!(
            "{name} must be {} to {} characters long.",
            rule.min, rule.max
        )));
    }
    Ok(text)
}

pub fn read_integer(body: &JsonObject, name: &str, min: i64, max: i64) -> Result<i64, ApiError> {
    let value = body
        .get(name)
        .ok_or_else(|| ApiError::bad_request(format!("{name} is required.")))?;
    whole_number(value)
        .filter(|number| *number >= min && *number <= max)
        .ok_or_else(|| ApiError::bad_request(format!("{name} must be a whole number from {min} to {max}.")))
}

/// A JSON number that is a whole number, such as 3 or 3.0.
pub fn whole_number(value: &Value) -> Option<i64> {
    if let Some(number) = value.as_i64() {
        return Some(number);
    }
    let number = value.as_f64()?;
    // 2^53, the largest whole number that JavaScript keeps exactly.
    (number.fract() == 0.0 && number.abs() <= 9_007_199_254_740_991.0).then_some(number as i64)
}

pub fn read_bool(body: &JsonObject, name: &str) -> Result<bool, ApiError> {
    match body.get(name) {
        Some(Value::Bool(value)) => Ok(*value),
        Some(_) => Err(ApiError::bad_request(format!("{name} must be true or false."))),
        None => Err(ApiError::bad_request(format!("{name} is required."))),
    }
}

/// Reads a field that must be present and may be null, for metadata the browser could not read.
pub fn read_nullable_number(body: &JsonObject, name: &str, min: f64, max: f64, integer: bool) -> Result<Option<f64>, ApiError> {
    let value = body
        .get(name)
        .ok_or_else(|| ApiError::bad_request(format!("{name} is required. Send null when it is unknown.")))?;
    if value.is_null() {
        return Ok(None);
    }
    let valid = value
        .as_f64()
        .filter(|number| number.is_finite() && *number >= min && *number <= max && (!integer || number.fract() == 0.0));
    valid.map(Some).ok_or_else(|| {
        ApiError::bad_request(format!(
            "{name} must be null or a {}number from {min} to {max}.",
            if integer { "whole " } else { "" }
        ))
    })
}

pub fn read_array<'a>(body: &'a JsonObject, name: &str, min_items: usize, max_items: usize) -> Result<&'a Vec<Value>, ApiError> {
    let value = body
        .get(name)
        .ok_or_else(|| ApiError::bad_request(format!("{name} is required.")))?;
    match value {
        Value::Array(items) if items.len() >= min_items && items.len() <= max_items => Ok(items),
        _ => Err(ApiError::bad_request(format!(
            "{name} must be an array of {min_items} to {max_items} items."
        ))),
    }
}

/// Reads an ID field that must be present and may be null.
pub fn read_nullable_id(body: &JsonObject, name: &str) -> Result<Option<String>, ApiError> {
    let value = body
        .get(name)
        .ok_or_else(|| ApiError::bad_request(format!("{name} is required. Send null for none.")))?;
    check_nullable_id(value, name)
}

/// Like read_nullable_id, but None when the field is absent, and Some(None) for null.
pub fn read_optional_nullable_id(body: &JsonObject, name: &str) -> Result<Option<Option<String>>, ApiError> {
    body.get(name).map(|value| check_nullable_id(value, name)).transpose()
}

fn check_nullable_id(value: &Value, name: &str) -> Result<Option<String>, ApiError> {
    match value {
        Value::Null => Ok(None),
        Value::String(id) if is_id(id) => Ok(Some(id.clone())),
        _ => Err(ApiError::bad_request(format!("{name} must be null or an ID."))),
    }
}
