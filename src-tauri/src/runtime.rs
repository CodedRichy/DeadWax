//! Everything the app does that is not a window.
//!
//! Factored out so the headless build (`--bin app`) and the desktop build
//! (`--bin deadwax`) run the SAME code. Two copies of the capture loop would
//! drift, and the headless one is what makes the collector debuggable without
//! a WebView in the way.

use crate::capture::{Capture, POLL};
use crate::press::shelf;
use crate::serve::{self, Live, State};
use crate::store::{Listen, Store};
use crate::tracker::Tracker;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub fn repo_root() -> PathBuf {
    // The crate sits at <repo>/src-tauri.
    Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf()
}

/// How stale the collector's heartbeat may get before the app stops trusting it.
/// The collector writes every 15s, so 90s is six missed beats -- long enough to
/// ride out a slow disk, short enough that a dead collector is noticed fast.
const WIDGET_STALE_SECS: i64 = 90;

/// What the tray collector is doing right now, read off the two files it
/// already publishes. Nothing new had to be built on that side.
#[derive(Default)]
pub struct Widget {
    /// Heartbeat is present and recent.
    pub alive: bool,
    pub paused: bool,
    pub live: Live,
}

fn read_json(p: &Path) -> Option<serde_json::Value> {
    serde_json::from_str(&std::fs::read_to_string(p).ok()?).ok()
}

fn secs_since(ts: &str) -> Option<i64> {
    let t = chrono::DateTime::parse_from_rfc3339(ts).ok()?;
    Some((chrono::Local::now().timestamp() - t.timestamp()).abs())
}

/// Read the collector's heartbeat and its now-playing file.
///
/// `dump/heartbeat.json` and `dump/live.json` are written by `tray.ps1` and
/// predate this code -- the app was simply never reading them. That is the whole
/// of the connection: the collector was already publishing its state.
pub fn widget(root: &Path) -> Widget {
    let dump = root.join("scripts/smtc/dump");
    let mut w = Widget::default();

    let Some(hb) = read_json(&dump.join("heartbeat.json")) else { return w };
    let fresh = hb
        .get("alive")
        .and_then(|v| v.as_str())
        .and_then(secs_since)
        .is_some_and(|age| age <= WIDGET_STALE_SECS);
    if !fresh {
        return w;
    }
    w.alive = true;
    w.paused = hb.get("paused").and_then(|v| v.as_bool()).unwrap_or(false);

    if let Some(lv) = read_json(&dump.join("live.json")) {
        let s = |v: &serde_json::Value, k: &str| {
            v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string()
        };
        // `tracking` is the collector's in-progress entries. The head one is
        // what is in the room; an empty array means nothing is.
        if let Some(t) = lv.get("tracking").and_then(|v| v.as_array()).and_then(|a| a.first()) {
            w.live = Live {
                // NOTE: heartbeat's `paused` is the COLLECTOR's pause switch,
                // not the player's. This file cannot say whether the music is
                // paused, which is exactly why live state is read from SMTC
                // directly in `live_loop` and this is only a fallback.
                playing: !w.paused,
                artist: s(t, "artist"),
                track: s(t, "title"),
                album: s(t, "album"),
                position: 0.0,
                duration: t.get("duration").and_then(|x| x.as_f64()).unwrap_or(0.0),
                sampled_ms: now_ms(),
            };
        }
    }
    w
}

/// Ingest everything the tray collector has captured that we do not have.
///
/// This used to run ONCE, gated on the log being empty, and was called
/// `backfill` -- which is what it was: a one-time import when the app was ported
/// from PowerShell. But the collector never stopped running. It kept writing
/// JSONL all day that the app had already decided it was finished reading, so
/// the app's log silently fell a full day behind the collector's while both
/// watched the same machine. It runs continuously now; `append_new` makes
/// re-reading the same lines free.
pub fn ingest(store: &Store, root: &Path) -> Result<usize, Box<dyn std::error::Error>> {
    let dump = root.join("scripts/smtc/dump");
    if !dump.exists() {
        return Ok(0);
    }
    let s = |v: &serde_json::Value, k: &str| {
        v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string()
    };
    let f = |v: &serde_json::Value, k: &str| v.get(k).and_then(|x| x.as_f64()).unwrap_or(0.0);

    let mut files: Vec<PathBuf> = std::fs::read_dir(&dump)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with("listens-") && n.ends_with(".jsonl"))
        })
        .collect();
    files.sort();

    let mut n = 0;
    for path in files {
        for line in std::fs::read_to_string(&path)?.lines() {
            if line.trim().is_empty() {
                continue;
            }
            let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };
            let new = store.append_new(&Listen {
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
            if new {
                n += 1;
            }
        }
    }
    Ok(n)
}

/// Seed covers and album lengths from the local web-build data file.
///
/// `deadwax-data.js` was generated once by `scripts/build-data.js` from a
/// Last.fm export. It is already on disk, already gitignored, and carries two
/// things the app cannot get for itself: the real album artwork, and the real
/// track count -- SMTC supplies neither.
///
/// Reading a file that is already here is NOT the network dependency the
/// project rules out. Nothing is fetched, and the app works identically if the
/// file is absent. It is a one-time transfer of what was already collected.
///
/// It covers only the albums in that export. Anything played since is still
/// blank until the bundled index ships, which fills the same `album_meta` slot.
pub fn seed_from_web_build(store: &Store, root: &Path) -> (usize, usize) {
    let path = root.join("deadwax-data.js");
    let Ok(text) = std::fs::read_to_string(&path) else { return (0, 0) };
    let (Some(a), Some(b)) = (text.find('{'), text.rfind('}')) else { return (0, 0) };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&text[a..=b]) else { return (0, 0) };
    let Some(shelf) = v.get("shelf").and_then(|s| s.as_array()) else { return (0, 0) };

    let (mut covers, mut lens) = (0, 0);
    for r in shelf {
        let artist = r.get("artist").and_then(|x| x.as_str()).unwrap_or("");
        let album = r.get("album").and_then(|x| x.as_str()).unwrap_or("");
        if artist.is_empty() || album.is_empty() {
            continue;
        }
        let key = crate::art::key(artist, album);
        if key.is_empty() {
            continue;
        }

        if let Some(n) = r.get("len").and_then(|x| x.as_u64()) {
            if n > 0 && store.set_len(&key, n as u32, "web-build").is_ok() {
                lens += 1;
            }
        }

        if crate::art::find(root, &key).is_none() {
            if let Some(bytes) = r
                .get("art")
                .and_then(|x| x.as_str())
                .and_then(crate::art::from_data_uri)
            {
                if crate::art::save(root, &key, &bytes).is_ok() {
                    covers += 1;
                }
            }
        }
    }
    (covers, lens)
}

/// Open the log, derive the shelf, start serving. Returns the state and the
/// bound port. Does NOT start capture -- see `spawn_capture`.
pub fn start(verbose: bool) -> Result<(Arc<State>, u16), Box<dyn std::error::Error>> {
    let root = repo_root();
    let store = Store::open(&root.join("src-tauri/deadwax.db"))?;
    store.event("start", "app")?;

    // Unconditional, every start. See `ingest` for why the old `== 0` gate was
    // the bug: it made the import a one-off and left the collector writing into
    // a file nothing read again.
    let n = ingest(&store, &root)?;
    if verbose {
        println!("ingested {n} new listens from the collector");
    }

    let (covers, lens) = seed_from_web_build(&store, &root);
    if verbose && (covers > 0 || lens > 0) {
        println!("seeded {covers} covers and {lens} album lengths from the web build");
    }

    let counted = store.counted_listens()?;
    let records = shelf(&counted);
    let in_progress = crate::press::all_records(&counted);
    if verbose {
        println!(
            "{} listens in the log, {} counted, {} records on the shelf",
            store.count()?,
            counted.len(),
            records.len()
        );
    }

    let state = Arc::new(State {
        lens: Mutex::new(store.lens().unwrap_or_default()),
        root,
        shelf: Mutex::new(records),
        pending: Mutex::new(in_progress),
        live: Mutex::new(Live::default()),
    });
    let port = serve::spawn(Arc::clone(&state), 8484)?;
    Ok((state, port))
}

/// Run the capture loop forever on this thread.
///
/// The shelf is re-derived from the WHOLE log on every change rather than
/// patched in place. That is the point: the shelf is a pure function of the log,
/// so a better rule later re-derives the entire history instead of inheriting
/// today's mistakes.
/// How often the collector's log is re-read.
const INGEST_EVERY: Duration = Duration::from_secs(10);

/// How often SMTC is asked what is playing and where in it.
///
/// This is OBSERVATION, not capture: it reads and never writes the log, so it
/// is safe to run alongside the tray collector and safe to run fast. Conflating
/// the two is what made pause invisible -- the app stood down from watching
/// entirely when it only needed to stand down from writing.
const LIVE_POLL: Duration = Duration::from_millis(250);

pub fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// Watch SMTC and keep `state.live` current. Never touches the log.
pub fn live_loop(state: Arc<State>) {
    let Ok(cap) = Capture::new() else {
        eprintln!("live state unavailable: SMTC could not be opened");
        return;
    };
    // Keys already attempted this run. A player that publishes no artwork must
    // not be asked again every 250ms for as long as it plays.
    let mut tried: std::collections::HashSet<String> = std::collections::HashSet::new();

    loop {
        let sessions = cap.poll().unwrap_or_default();
        // A playing session wins over a merely-present one: a paused browser tab
        // must not mask what is actually coming out of the speakers.
        let np = sessions.iter().find(|s| s.playing).or_else(|| sessions.first());
        let live = match np {
            Some(n) => {
                // Age the snapshot forward to NOW.
                //
                // SMTC hands back where the track was when the player last told
                // Windows, which can be seconds ago -- so reporting it straight
                // showed the song several seconds behind where Spotify said it
                // was. `LastUpdatedTime` is how far behind, so add it back while
                // the track is actually running. Clamped: a player that goes
                // quiet for a minute must not have a minute added to it, and a
                // paused track is not moving at all.
                let now = now_ms();
                let age = if n.playing && n.position_updated_ms > 0 {
                    ((now.saturating_sub(n.position_updated_ms)) as f64 / 1000.0).min(10.0)
                } else {
                    0.0
                };
                let mut position = n.position_sec + age;
                if n.duration_sec > 0.0 {
                    position = position.min(n.duration_sec);
                }
                Live {
                    playing: n.playing,
                    artist: n.artist.clone(),
                    track: n.title.clone(),
                    album: n.album_title.clone(),
                    position,
                    duration: n.duration_sec,
                    sampled_ms: now,
                }
            }
            None => Live::default(),
        };
        *state.live.lock().unwrap() = live;

        // Grab the cover while it is on. This is the only moment it is
        // available -- SMTC publishes the thumbnail of what is playing, so a
        // record's sleeve can only be collected by playing it. Once per key per
        // run, and never if it is already on disk.
        if let Some(n) = np {
            if !n.artist.is_empty() && !n.album_title.is_empty() {
                let k = crate::art::key(&n.artist, &n.album_title);
                if !k.is_empty() && !tried.contains(&k) && crate::art::find(&state.root, &k).is_none()
                {
                    tried.insert(k.clone());
                    if let Some(bytes) = cap.thumbnail(&n.title) {
                        if let Err(e) = crate::art::save(&state.root, &k, &bytes) {
                            eprintln!("could not store cover for {k}: {e}");
                        }
                    }
                }
            }
        }

        std::thread::sleep(LIVE_POLL);
    }
}

pub fn capture_loop(state: Arc<State>, verbose: bool) {
    let store = match Store::open(&state.root.join("src-tauri/deadwax.db")) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("capture halted, cannot open the log: {e}");
            return;
        }
    };
    // SMTC may be unavailable (no session manager, locked-down box). That is
    // not fatal any more: if the tray collector is running, it feeds us and the
    // app never needs to poll SMTC itself.
    let cap = Capture::new().ok();
    if cap.is_none() {
        eprintln!("SMTC unavailable to the app; depending on the tray collector");
    }
    let mut tracker = Tracker::new(POLL.as_secs_f64());

    // Force an ingest on the first tick rather than waiting out the interval.
    let mut ticks_since_ingest = u32::MAX;
    let ingest_every = (INGEST_EVERY.as_secs_f64() / POLL.as_secs_f64()).max(1.0) as u32;
    let mut was_deferring = None;

    loop {
        let w = widget(&state.root);

        if verbose && was_deferring != Some(w.alive) {
            println!(
                "{}",
                if w.alive {
                    "collector is up -- deferring capture to it"
                } else {
                    "collector is down -- capturing directly"
                }
            );
            was_deferring = Some(w.alive);
        }

        if w.alive {
            // ONE COLLECTOR AT A TIME.
            //
            // Both this and the tray poll the same SMTC session. Run them
            // together and a single listen is written twice, seconds apart,
            // because their polls land at different points in the track -- two
            // rows with different start times, different dwell, and no key that
            // can merge them afterwards. Duplicates in an append-only evidence
            // log cannot be cleaned up later, so they are prevented here
            // instead: while the tray is alive it owns capture outright, and
            // this loop only reads what it wrote. Live state is NOT set here:
            // `live_loop` owns it in both branches, because observing SMTC
            // creates no rows and therefore never needed to stand down.
        } else if let Some(cap) = cap.as_ref() {
            let sessions = cap.poll().unwrap_or_default();
            let finished = tracker.tick(&sessions);

            if !finished.is_empty() {
                for l in &finished {
                    if verbose {
                        let mark = if l.counted { "kept " } else { "short" };
                        println!("  [{mark}] {} - {}  ({:.0}s)", l.artist, l.title, l.dwell_sec);
                    }
                    if let Err(e) = store.append(l) {
                        eprintln!("could not write listen: {e}");
                    }
                }
                reshelf(&store, &state, verbose);
            }
        }

        // Pick up whatever the collector has finished writing. Cheap when there
        // is nothing new, which is almost always.
        ticks_since_ingest = ticks_since_ingest.saturating_add(1);
        if ticks_since_ingest >= ingest_every {
            ticks_since_ingest = 0;
            match ingest(&store, &state.root) {
                Ok(0) => {}
                Ok(n) => {
                    if verbose {
                        println!("  ingested {n} listens from the collector");
                    }
                    reshelf(&store, &state, verbose);
                }
                Err(e) => eprintln!("could not read the collector's log: {e}"),
            }
        }

        std::thread::sleep(POLL);
    }
}

/// Re-derive the whole shelf from the whole log. See the note on `capture_loop`.
fn reshelf(store: &Store, state: &State, verbose: bool) {
    if let Ok(counted) = store.counted_listens() {
        let fresh = shelf(&counted);
        if verbose {
            println!("  shelf: {} records", fresh.len());
        }
        *state.shelf.lock().unwrap() = fresh;
        *state.pending.lock().unwrap() = crate::press::all_records(&counted);
    }
}

pub fn spawn_capture(state: Arc<State>, verbose: bool) {
    let live = Arc::clone(&state);
    std::thread::spawn(move || live_loop(live));
    std::thread::spawn(move || capture_loop(state, verbose));
}
