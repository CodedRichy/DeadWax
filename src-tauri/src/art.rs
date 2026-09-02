//! The album art cache.
//!
//! WHERE THE COVERS COME FROM
//! --------------------------
//! The web build got its covers from Last.fm, baked into `deadwax-data.js` by
//! `scripts/build-data.js`. The app cannot do that: calling Last.fm is ruled out
//! until commercial terms are cleared, and an app that ships offline forever
//! must not need a network to show a sleeve.
//!
//! Windows already has the answer. SMTC publishes the thumbnail the player is
//! displaying right now -- the real cover, on this machine, with no API, no key
//! and no terms attached. It is captured as it plays and kept here.
//!
//! NOT IN GIT
//! ----------
//! This directory holds copyrighted album artwork keyed to one person's
//! listening. It is ignored, for the same reason `deadwax-data.js` and the
//! collector's dumps are: the code is public, what it captured is not.

use std::path::{Path, PathBuf};

/// Cache key for a record, folded the SAME way `press` groups listens.
///
/// If this used the raw album title, a cover captured while playing
/// "P3 [10-YEAR EDITION]" would never be found again by the record that folding
/// turned into "PARTYNEXTDOOR 3 (P3)" -- art would be captured constantly and
/// displayed never.
pub fn key(artist: &str, album: &str) -> String {
    let a = crate::press::fold_artist(artist);
    let t = crate::press::fold_title(album).key;
    let raw = format!("{a}--{t}");
    let mut out = String::with_capacity(raw.len());
    for c in raw.chars() {
        match c {
            'a'..='z' | '0'..='9' | '-' => out.push(c),
            'A'..='Z' => out.push(c.to_ascii_lowercase()),
            ' ' | '_' => out.push('-'),
            _ => {}
        }
    }
    // Bound the filename. Two albums colliding after 96 characters of folded
    // artist and title is a cost worth paying to never hand the filesystem a
    // 400-character name.
    out.chars().take(96).collect()
}

pub fn dir(root: &Path) -> PathBuf {
    root.join("src-tauri/art")
}

/// Sniff the format instead of trusting an extension nobody supplied. SMTC
/// hands over bytes with no filename at all.
fn ext(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some("png")
    } else {
        None
    }
}

/// The cached file for a key, if one exists.
pub fn find(root: &Path, key: &str) -> Option<PathBuf> {
    for e in ["jpg", "png"] {
        let p = dir(root).join(format!("{key}.{e}"));
        if p.exists() {
            return Some(p);
        }
    }
    None
}

/// Store bytes for a key. Refuses anything that is not an image we recognise.
pub fn save(root: &Path, key: &str, bytes: &[u8]) -> std::io::Result<PathBuf> {
    let Some(e) = ext(bytes) else {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "not a jpeg or png",
        ));
    };
    let d = dir(root);
    std::fs::create_dir_all(&d)?;
    let p = d.join(format!("{key}.{e}"));
    std::fs::write(&p, bytes)?;
    Ok(p)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_folds_editions_onto_one_cover() {
        // The whole point: an edition-tagged album must land on the same key as
        // the record it folds into, or its cover is captured and never found.
        assert_eq!(
            key("PARTYNEXTDOOR", "PARTYNEXTDOOR 3 (P3) [10-YEAR EDITION]"),
            key("PARTYNEXTDOOR", "PARTYNEXTDOOR 3 (P3)")
        );
    }

    #[test]
    fn key_is_filesystem_safe_and_bounded() {
        let k = key("AC/DC ??", "Back in Black: 40th Anniversary <edition>");
        assert!(k.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'), "{k}");
        assert!(k.len() <= 96);
        assert!(!k.is_empty());
    }

    #[test]
    fn different_albums_do_not_share_a_key() {
        assert_ne!(key("Tame Impala", "Currents"), key("Tame Impala", "Lonerism"));
    }

    #[test]
    fn save_refuses_non_images() {
        let tmp = std::env::temp_dir().join("deadwax-art-test");
        let _ = std::fs::remove_dir_all(&tmp);
        assert!(save(&tmp, "x", b"<html>nope</html>").is_err());
    }
}
