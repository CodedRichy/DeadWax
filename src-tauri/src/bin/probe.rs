//! Proves the SMTC port against the running machine before anything is built
//! on top of it.
//!
//! Prints every session Windows reports, once per poll, and flags the two
//! things that decide the architecture: whether a denominator ever arrives, and
//! whether non-music sessions show up.
//!
//!   cargo run --bin probe

use deadwax::capture::{Capture, POLL};
use std::collections::HashMap;

fn main() -> windows::core::Result<()> {
    let cap = Capture::new()?;
    println!("SMTC probe. Ctrl-C to stop.\n");

    let mut seen: HashMap<String, ()> = HashMap::new();
    let mut polls = 0u32;
    let mut denominator_ever = false;

    loop {
        let sessions = cap.poll()?;
        polls += 1;

        for s in &sessions {
            if s.album_track_count > 0 {
                denominator_ever = true;
            }
            let key = format!("{}::{}", s.source_app, s.identity());
            if seen.insert(key, ()).is_none() {
                println!("  source   {}", s.source_app);
                println!("  title    {}", s.title);
                println!("  artist   {}", s.artist);
                println!("  album    {}", if s.album_title.is_empty() { "(none)" } else { &s.album_title });
                println!("  track    {} of {}", s.track_number, s.album_track_count);
                println!("  type     {}", s.playback_type);
                println!("  length   {:.1}s   playing={}", s.duration_sec, s.playing);
                println!();
            }
        }

        if polls % 15 == 0 {
            println!("[{} polls, {} distinct tracks, denominator supplied: {}]",
                     polls, seen.len(), denominator_ever);
        }
        std::thread::sleep(POLL);
    }
}
