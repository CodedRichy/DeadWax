//! Derive a shelf from the listens the PowerShell collector already captured.
//!
//! This is the port's real test. The unit suites prove the rules in isolation;
//! this proves the whole spine against evidence that was recorded before any of
//! this Rust existed.
//!
//!   cargo run --bin derive

use deadwax::press::{closest_to_pressing, shelf, TEST_PRESSING_FLOOR};
use deadwax::store::{Listen, Store};
use std::path::Path;

fn s(v: &serde_json::Value, k: &str) -> String {
    v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string()
}
fn f(v: &serde_json::Value, k: &str) -> f64 {
    v.get(k).and_then(|x| x.as_f64()).unwrap_or(0.0)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let dump = Path::new("../scripts/smtc/dump");
    let store = Store::open_in_memory()?;

    let mut files: Vec<_> = std::fs::read_dir(dump)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with("listens-") && n.ends_with(".jsonl"))
        })
        .collect();
    files.sort();

    let mut read = 0;
    for path in &files {
        for line in std::fs::read_to_string(path)?.lines() {
            if line.trim().is_empty() {
                continue;
            }
            let v: serde_json::Value = serde_json::from_str(line)?;
            read += 1;
            store.append(&Listen {
                started_at: s(&v, "ts"),
                ended_at: s(&v, "endedAt"),
                source_app: s(&v, "sourceApp"),
                title: s(&v, "title"),
                artist: s(&v, "artist"),
                album_title: s(&v, "albumTitle"),
                album_artist: s(&v, "albumArtist"),
                track_number: f(&v, "trackNumber") as i32,
                album_track_count: f(&v, "albumTrackCount") as i32,
                playback_type: s(&v, "playbackType"),
                duration_sec: f(&v, "durationSec"),
                dwell_sec: f(&v, "dwellSec"),
                counted: v.get("counted").and_then(|x| x.as_bool()).unwrap_or(false),
                end_reason: s(&v, "endReason"),
            })?;
        }
    }

    let counted = store.counted_listens()?;
    println!("\n{} captured, {} counted as real listens\n", read, counted.len());

    let records = shelf(&counted);
    if records.is_empty() {
        println!("No records pressed. Floor is {} distinct tracks.", TEST_PRESSING_FLOOR);
    }
    for r in &records {
        println!("  {} - {}", r.artist, r.album);
        println!("    {} plays, {} distinct tracks, {:?}", r.plays, r.heard, r.tier);
    }

    if let Some((artist, album, heard)) = closest_to_pressing(&counted) {
        println!("\nclosest to pressing");
        println!("  {} - {}", artist, album);
        println!("  {} of {} tracks", heard, TEST_PRESSING_FLOOR);
    }
    println!();
    Ok(())
}
