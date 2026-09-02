//! Turns a stream of SMTC polls into finished listens.
//!
//! Port of the state machine proven in `scripts/smtc/tray.ps1`. Three behaviours
//! here were each paid for with a real defect, and none of them are obvious:
//!
//! 1. DWELL ACCRUES ONLY WHILE PLAYING. A paused session sitting on screen for
//!    an hour must manufacture nothing.
//!
//! 2. A RECORD IS WRITTEN WHEN A TRACK ENDS, not when it starts, because the
//!    thing being measured is how long it was actually listened to. That leaves
//!    in-flight tracks invisible, so live state is exposed separately.
//!
//! 3. CHROME FLAPS. A browser session can vanish and return within a second or
//!    two, which split one listen into two stubs -- observed 2026-08-19,
//!    "PARTYNEXTDOOR- Something New" written twice, 2s then 14s. Anything too
//!    short to be real is PARKED rather than written, and either resumed by the
//!    next poll or retired by the sweep.

use crate::capture::NowPlaying;
use crate::store::Listen;
use std::collections::HashMap;
use std::time::{Duration, Instant};

/// Below this, a finished track is assumed to be a flap rather than a listen
/// and is parked instead of written.
const STUB_SECS: f64 = 5.0;

/// How long a parked stub waits to be resumed before it is retired as a genuine
/// skip.
const LIMBO: Duration = Duration::from_secs(20);

/// The standard scrobble rule: half the track, or four minutes, whichever comes
/// first. Anything shorter is still RECORDED, but flagged uncounted -- pressing
/// records off accidental skips would put albums on a shelf that were never
/// listened to.
fn counts(duration_sec: f64, dwell_sec: f64) -> bool {
    let threshold = if duration_sec > 0.0 {
        (duration_sec / 2.0).min(240.0)
    } else {
        30.0
    };
    dwell_sec >= threshold
}

#[derive(Debug, Clone)]
struct Entry {
    np: NowPlaying,
    identity: String,
    started_at: String,
    dwell: f64,
    parked_at: Option<Instant>,
    park_reason: String,
}

impl Entry {
    fn new(np: NowPlaying) -> Self {
        Self {
            identity: np.identity(),
            started_at: crate::now_iso(),
            np,
            dwell: 0.0,
            parked_at: None,
            park_reason: String::new(),
        }
    }

    fn finish(&self, reason: &str) -> Listen {
        Listen {
            started_at: self.started_at.clone(),
            ended_at: crate::now_iso(),
            source_app: self.np.source_app.clone(),
            title: self.np.title.clone(),
            artist: self.np.artist.clone(),
            album_title: self.np.album_title.clone(),
            album_artist: self.np.album_artist.clone(),
            track_number: self.np.track_number,
            album_track_count: self.np.album_track_count,
            playback_type: self.np.playback_type.clone(),
            duration_sec: self.np.duration_sec,
            dwell_sec: (self.dwell * 10.0).round() / 10.0,
            counted: counts(self.np.duration_sec, self.dwell),
            end_reason: reason.to_string(),
        }
    }
}

pub struct Tracker {
    /// One in-flight entry per source app.
    live: HashMap<String, Entry>,
    /// Stubs waiting to be resumed, keyed by track identity.
    limbo: HashMap<String, Entry>,
    poll_secs: f64,
}

impl Tracker {
    pub fn new(poll_secs: f64) -> Self {
        Self { live: HashMap::new(), limbo: HashMap::new(), poll_secs }
    }

    /// Feed one poll. Returns any listens that finished as a result.
    pub fn tick(&mut self, sessions: &[NowPlaying]) -> Vec<Listen> {
        let mut finished = Vec::new();
        let mut seen: Vec<String> = Vec::with_capacity(sessions.len());

        for np in sessions {
            let app = np.source_app.clone();
            seen.push(app.clone());
            let identity = np.identity();

            // Track changed under an app that was already playing.
            if let Some(existing) = self.live.get(&app) {
                if existing.identity != identity {
                    let e = self.live.remove(&app).unwrap();
                    self.retire(e, "track changed", &mut finished);
                }
            }

            if !self.live.contains_key(&app) {
                // A parked stub for this exact track means the session flapped.
                // Resume it so dwell keeps accruing on ONE record.
                let entry = match self.limbo.remove(&identity) {
                    Some(mut parked) => {
                        parked.parked_at = None;
                        parked.park_reason.clear();
                        parked
                    }
                    None => Entry::new(np.clone()),
                };
                self.live.insert(app.clone(), entry);
            }

            if let Some(e) = self.live.get_mut(&app) {
                if np.playing {
                    e.dwell += self.poll_secs;
                }
                // Duration can arrive a poll or two after the track does.
                if np.duration_sec > 0.0 {
                    e.np.duration_sec = np.duration_sec;
                }
            }
        }

        // A source that vanished still owes its final record. NOT final: a
        // browser closing a session for two seconds is exactly the flap case.
        let gone: Vec<String> =
            self.live.keys().filter(|a| !seen.contains(a)).cloned().collect();
        for app in gone {
            if let Some(e) = self.live.remove(&app) {
                self.retire(e, "source closed", &mut finished);
            }
        }

        self.sweep(&mut finished);
        finished
    }

    /// Park anything too short to be real; write everything else.
    fn retire(&mut self, mut e: Entry, reason: &str, out: &mut Vec<Listen>) {
        if e.dwell < STUB_SECS {
            e.parked_at = Some(Instant::now());
            e.park_reason = reason.to_string();
            self.limbo.insert(e.identity.clone(), e);
            return;
        }
        out.push(e.finish(reason));
    }

    /// A stub nobody came back for was a genuine skip. Write it, uncounted.
    fn sweep(&mut self, out: &mut Vec<Listen>) {
        let expired: Vec<String> = self
            .limbo
            .iter()
            .filter(|(_, e)| e.parked_at.map(|t| t.elapsed() >= LIMBO).unwrap_or(false))
            .map(|(k, _)| k.clone())
            .collect();
        for k in expired {
            if let Some(e) = self.limbo.remove(&k) {
                let reason = e.park_reason.clone();
                out.push(e.finish(&reason));
            }
        }
    }

    /// Everything in flight, for the live view. A track only becomes a row in
    /// the log when it ends, so without this the current track is invisible.
    pub fn in_flight(&self) -> Vec<(&NowPlaying, f64)> {
        self.live.values().map(|e| (&e.np, e.dwell)).collect()
    }

    /// The session with the most dwell -- what the platter should be showing.
    pub fn front(&self) -> Option<(&NowPlaying, f64)> {
        self.live
            .values()
            .max_by(|a, b| a.dwell.partial_cmp(&b.dwell).unwrap_or(std::cmp::Ordering::Equal))
            .map(|e| (&e.np, e.dwell))
    }

    /// Shutdown. Nothing is parked on the way out -- there is no next poll to
    /// resume from, so everything in flight and everything parked is written.
    pub fn drain(&mut self, reason: &str) -> Vec<Listen> {
        let mut out: Vec<Listen> = self.live.drain().map(|(_, e)| e.finish(reason)).collect();
        out.extend(self.limbo.drain().map(|(_, e)| e.finish(reason)));
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn np(app: &str, title: &str, playing: bool, dur: f64) -> NowPlaying {
        NowPlaying {
            source_app: app.into(),
            title: title.into(),
            artist: "PARTYNEXTDOOR".into(),
            album_title: "PARTYNEXTDOOR TWO".into(),
            album_artist: "PARTYNEXTDOOR".into(),
            track_number: 1,
            album_track_count: 0,
            playback_type: "Music".into(),
            duration_sec: dur,
            position_sec: 0.0,
            position_updated_ms: 0,
            playing,
        }
    }

    #[test]
    fn dwell_accrues_only_while_playing() {
        let mut t = Tracker::new(2.0);
        for _ in 0..5 {
            t.tick(&[np("Spotify.exe", "Bout It", false, 200.0)]);
        }
        assert_eq!(t.front().unwrap().1, 0.0, "paused must accrue nothing");

        for _ in 0..5 {
            t.tick(&[np("Spotify.exe", "Bout It", true, 200.0)]);
        }
        assert_eq!(t.front().unwrap().1, 10.0);
    }

    #[test]
    fn a_real_listen_is_counted_a_skip_is_not() {
        let mut t = Tracker::new(2.0);
        // 120s of a 200s track clears the half-length threshold.
        for _ in 0..60 {
            t.tick(&[np("Spotify.exe", "Bout It", true, 200.0)]);
        }
        let done = t.tick(&[np("Spotify.exe", "Next Track", true, 200.0)]);
        assert_eq!(done.len(), 1);
        assert!(done[0].counted);
        assert_eq!(done[0].end_reason, "track changed");
    }

    #[test]
    fn short_play_is_recorded_but_uncounted() {
        let mut t = Tracker::new(2.0);
        // 10s of a 200s track: past the stub floor, nowhere near the threshold.
        for _ in 0..5 {
            t.tick(&[np("Spotify.exe", "Bout It", true, 200.0)]);
        }
        let done = t.tick(&[np("Spotify.exe", "Next Track", true, 200.0)]);
        assert_eq!(done.len(), 1);
        assert!(!done[0].counted, "a skip is evidence, not a listen");
    }

    #[test]
    fn chrome_flap_does_not_split_one_listen_in_two() {
        // The real 2026-08-19 defect: "Something New" written twice, 2s then 14s.
        let mut t = Tracker::new(2.0);
        t.tick(&[np("Chrome", "Something New", true, 200.0)]);   // 2s
        let mid = t.tick(&[]);                                    // session vanishes
        assert!(mid.is_empty(), "a 2s stub must be parked, not written");

        // It comes back within the limbo window.
        for _ in 0..7 {
            t.tick(&[np("Chrome", "Something New", true, 200.0)]);
        }
        assert_eq!(t.front().unwrap().1, 16.0, "dwell must resume, not restart");

        let done = t.tick(&[np("Chrome", "A Different Track", true, 200.0)]);
        assert_eq!(done.len(), 1, "one listen, not two");
    }

    #[test]
    fn two_sources_are_tracked_independently() {
        let mut t = Tracker::new(2.0);
        t.tick(&[np("Spotify.exe", "Bout It", true, 200.0), np("Chrome", "Other", true, 200.0)]);
        assert_eq!(t.in_flight().len(), 2);
    }

    #[test]
    fn drain_writes_everything_including_parked() {
        let mut t = Tracker::new(2.0);
        t.tick(&[np("Spotify.exe", "Bout It", true, 200.0)]);
        t.tick(&[]); // parked as a stub
        let out = t.drain("collector quit");
        assert_eq!(out.len(), 1, "shutdown has no next poll to resume from");
        assert_eq!(out[0].end_reason, "collector quit");
    }
}
