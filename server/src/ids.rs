//! IDs, tokens, and their hashes.

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use sha2::{Digest, Sha256};

const ALPHABET: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";

fn random_bytes<const N: usize>() -> [u8; N] {
    let mut bytes = [0u8; N];
    getrandom::fill(&mut bytes).expect("the operating system gives random bytes");
    bytes
}

/// A random ID of 16 digits and lowercase letters, for a video, a person, a series, a comment,
/// an attachment, a playlist, or an invitation.
pub fn random_id() -> String {
    random_bytes::<16>()
        .iter()
        .map(|byte| ALPHABET[usize::from(*byte) % ALPHABET.len()] as char)
        .collect()
}

/// Whether the text has the form of an ID.
pub fn is_id(text: &str) -> bool {
    text.len() == 16 && text.bytes().all(|byte| byte.is_ascii_digit() || byte.is_ascii_lowercase())
}

/// A secret of 256 random bits, for a session or an invitation, in 43 characters of base64url.
pub fn random_token() -> String {
    URL_SAFE_NO_PAD.encode(random_bytes::<32>())
}

/// A code of eight letters and digits that read clearly, as XXXX-XXXX, for the setup.
pub fn setup_code() -> String {
    // No 0, O, 1, I, or L, which people mistake for each other.
    const CLEAR: &[u8] = b"23456789ABCDEFGHJKMNPQRSTUVWXYZ";
    let code: String = random_bytes::<8>()
        .iter()
        .map(|byte| CLEAR[usize::from(*byte) % CLEAR.len()] as char)
        .collect();
    format!("{}-{}", &code[..4], &code[4..])
}

/// The SHA-256 of the text, in hexadecimal: what albireo stores in place of a token or a code.
pub fn sha256_hex(text: &str) -> String {
    hex::encode(Sha256::digest(text.as_bytes()))
}
