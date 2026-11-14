//! The limits that the browser app and the server share, as shared/api.ts names them, and the
//! plan of the parts of an upload.

pub const TITLE_MAX_LENGTH: usize = 200;
pub const DESCRIPTION_MAX_LENGTH: usize = 5000;
pub const DISPLAY_NAME_MAX_LENGTH: usize = 50;
pub const BIO_MAX_LENGTH: usize = 1000;
pub const LIST_PAGE_SIZE: i64 = 48;
pub const MAX_PART_URLS_PER_REQUEST: usize = 100;
pub const COMMENT_MAX_LENGTH: usize = 2000;
pub const RATING_MAX_STARS: i64 = 5;
pub const SEARCH_QUERY_MAX_LENGTH: usize = 100;
pub const ATTACHMENT_MAX_BYTES: i64 = 500 * 1024 * 1024;
pub const ATTACHMENT_NAME_MAX_LENGTH: usize = 255;
pub const PASSWORD_MAX_LENGTH: usize = 200;
pub const EMAIL_MAX_LENGTH: usize = 254;
/// The languages of the browser app. Each person chooses one on the account page.
pub const LANGUAGES: [&str; 2] = ["en", "ja"];

const MIB: i64 = 1024 * 1024;
/// S3-compatible storage takes parts of at least 5 MiB but the last; albireo sends 16 MiB or more.
pub const MIN_PART_SIZE: i64 = 16 * MIB;
pub const MAX_PART_COUNT: i64 = 10_000;
/// The largest object that S3-compatible storage takes: 5 TiB.
pub const MAX_OBJECT_SIZE: i64 = 5 * 1024 * 1024 * MIB;

/// The size and the number of the parts of an upload: at most 10,000 parts, each at least 16 MiB.
pub fn plan_parts(file_size: i64) -> Result<(i64, i64), &'static str> {
    if file_size <= 0 {
        return Err("The file size must be a positive whole number of bytes.");
    }
    if file_size > MAX_OBJECT_SIZE {
        return Err("The file is larger than 5 TiB, the largest object that S3-compatible storage accepts.");
    }
    // Round up to whole mebibytes so that 10,000 parts always cover the file.
    let smallest_for_count = (file_size + MAX_PART_COUNT * MIB - 1) / (MAX_PART_COUNT * MIB) * MIB;
    let part_size = MIN_PART_SIZE.max(smallest_for_count);
    Ok((part_size, (file_size + part_size - 1) / part_size))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plans_parts_of_16_mib_for_most_files() {
        assert_eq!(plan_parts(40 * MIB), Ok((16 * MIB, 3)));
        assert_eq!(plan_parts(1), Ok((16 * MIB, 1)));
    }

    #[test]
    fn grows_the_parts_so_that_10000_cover_the_largest_files() {
        let (part_size, count) = plan_parts(MAX_OBJECT_SIZE).unwrap();
        assert!(count <= MAX_PART_COUNT);
        assert_eq!(part_size % MIB, 0);
        assert!(part_size * count >= MAX_OBJECT_SIZE);
    }

    #[test]
    fn refuses_empty_and_too_large_files() {
        assert!(plan_parts(0).is_err());
        assert!(plan_parts(MAX_OBJECT_SIZE + 1).is_err());
    }
}
