use axum::http::{HeaderMap, header};

pub fn has_internal_bearer(headers: &HeaderMap, expected_token: &str) -> bool {
    let Some(value) = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
    else {
        return false;
    };

    let Some(token) = value.strip_prefix("Bearer ") else {
        return false;
    };

    constant_time_eq(token.as_bytes(), expected_token.as_bytes())
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }

    left.iter()
        .zip(right)
        .fold(0_u8, |acc, (a, b)| acc | (a ^ b))
        == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_different_length_tokens() {
        assert!(!constant_time_eq(b"abc", b"abcd"));
    }

    #[test]
    fn accepts_equal_tokens() {
        assert!(constant_time_eq(b"abc", b"abc"));
    }
}
