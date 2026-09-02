//! Now-playing capture through the Windows System Media Transport Controls.
//!
//! This is the Rust port of the polling loop proven in `scripts/smtc/tray.ps1`.
//! The PowerShell collector stays the reference implementation until this path
//! is verified against it; it is not the product.
//!
//! WHAT SMTC ACTUALLY GIVES YOU
//! ----------------------------
//! Every player that integrates with Windows media keys publishes a session:
//! Spotify, Apple Music, the modern Media Player, and every Chromium browser.
//! One code path covers all of them, which is why this and not per-app scraping.
//!
//! Two findings from the 2026-08-17 capture that shape this module:
//!
//! 1. `AlbumTrackCount` is ALWAYS 0. Not a Spotify quirk -- verified by tagging
//!    a local MP3 `track=3/12` with ffmpeg and playing it in the modern Media
//!    Player, which reported `TrackNumber: 3, AlbumTrackCount: 0`. No source
//!    supplies the denominator, so album completeness cannot be computed from
//!    SMTC at all. That is what forces the bundled index.
//!
//! 2. Browsers publish NON-MUSIC as media sessions. An Aternos Minecraft server
//!    page appeared beside Spotify during a real capture. Filtering is not an
//!    edge case here; see `resolve`.
//!
//! DWELL, NOT PLAYS
//! ----------------
//! Nothing here counts a play on sight. A track accrues dwell only while its
//! session actually reports `Playing`, so leaving something paused for an hour
//! manufactures nothing. The scrobble decision happens when a track ENDS.

use std::time::Duration;
use windows::core::Interface;
use windows::Storage::Streams::{DataReader, IInputStream};
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as SessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
};

/// One media session as Windows currently reports it.
///
/// Every field is exactly what SMTC said, unmodified. Cleanup belongs in
/// `resolve`, downstream -- this layer must stay a faithful record of what the
/// operating system claimed, because that is the evidence everything else is
/// derived from.
#[derive(Debug, Clone, PartialEq)]
pub struct NowPlaying {
    pub source_app: String,
    pub title: String,
    pub artist: String,
    pub album_title: String,
    pub album_artist: String,
    pub track_number: i32,
    /// Always 0 in practice. Kept because it is what SMTC returned, and a
    /// future Windows build supplying it should be visible rather than assumed
    /// impossible.
    pub album_track_count: i32,
    pub playback_type: String,
    pub duration_sec: f64,
    pub position_sec: f64,
    /// When `position_sec` was actually true, as unix milliseconds.
    ///
    /// SMTC's position does NOT tick -- it is refreshed when the player feels
    /// like telling Windows, which can be several seconds apart. Reading it as
    /// "now" therefore reports the track several seconds behind where it really
    /// is. Windows supplies `LastUpdatedTime` for exactly this, so the snapshot
    /// travels with its own timestamp and whoever displays it can age it
    /// forward. 0 means Windows did not say.
    pub position_updated_ms: u128,
    pub playing: bool,
}

impl NowPlaying {
    /// Identity for change detection. Title alone is not enough -- two tracks
    /// can share a name across albums, and a browser tab can change album while
    /// keeping the title.
    pub fn identity(&self) -> String {
        format!("{}|{}|{}", self.title, self.artist, self.album_title)
    }
}

/// Holds the SMTC session manager for the life of the process.
///
/// `RequestAsync` is a real cross-process call and must not run per poll.
pub struct Capture {
    manager: SessionManager,
}

impl Capture {
    pub fn new() -> windows::core::Result<Self> {
        let manager = SessionManager::RequestAsync()?.get()?;
        Ok(Self { manager })
    }

    /// Every session Windows currently knows about.
    ///
    /// A session that fails to answer is SKIPPED, never fatal. Players come and
    /// go mid-enumeration and a browser tab can die between the session list
    /// and the property read; one bad session must not cost the whole poll.
    pub fn poll(&self) -> windows::core::Result<Vec<NowPlaying>> {
        let sessions = self.manager.GetSessions()?;
        let mut out = Vec::new();

        for session in sessions {
            if let Some(np) = Self::read_session(&session) {
                out.push(np);
            }
        }
        Ok(out)
    }

    /// The cover the player is currently displaying, as raw image bytes.
    ///
    /// This is the local answer to artwork. The web build fetched covers from
    /// Last.fm; the app may not, and must work with no network at all -- but
    /// Windows is already holding the real sleeve, because the player handed it
    /// over to draw the volume flyout. `Thumbnail` is that image.
    ///
    /// Matched on title rather than taken from a stored session handle: sessions
    /// are recreated as players come and go, and a stale handle reads as an
    /// error at a random moment later.
    pub fn thumbnail(&self, title: &str) -> Option<Vec<u8>> {
        for session in self.manager.GetSessions().ok()? {
            let props = session.TryGetMediaPropertiesAsync().ok()?.get().ok()?;
            if props.Title().ok()?.to_string_lossy() != title {
                continue;
            }
            let reference = props.Thumbnail().ok()?;
            let stream = reference.OpenReadAsync().ok()?.get().ok()?;
            let size = stream.Size().ok()?;
            // 0 is "this player publishes no art". The ceiling is a guard: this
            // is decoded into memory and handed to a WebView, and nothing
            // legitimate arrives as an 8MB thumbnail.
            if size == 0 || size > 8 * 1024 * 1024 {
                return None;
            }
            let input: IInputStream = stream.cast().ok()?;
            let reader = DataReader::CreateDataReader(&input).ok()?;
            reader.LoadAsync(size as u32).ok()?.get().ok()?;
            let mut buf = vec![0u8; size as usize];
            reader.ReadBytes(&mut buf).ok()?;
            return Some(buf);
        }
        None
    }

    fn read_session(session: &Session) -> Option<NowPlaying> {
        let props = session.TryGetMediaPropertiesAsync().ok()?.get().ok()?;

        // A session with no title is a player that is loaded but idle. There is
        // nothing to record and nothing to press.
        let title = props.Title().ok()?.to_string_lossy();
        if title.trim().is_empty() {
            return None;
        }

        let source_app = session
            .SourceAppUserModelId()
            .map(|s| s.to_string_lossy())
            .unwrap_or_default();

        let playing = session
            .GetPlaybackInfo()
            .and_then(|i| i.PlaybackStatus())
            .map(|s| s == PlaybackStatus::Playing)
            .unwrap_or(false);

        // Timeline is a snapshot, not a clock: EndTime is the track length and
        // Position is where the stylus was when Windows last updated it. It
        // does not tick on its own, so it must never be used as a timer.
        let (duration_sec, position_sec, position_updated_ms) = session
            .GetTimelineProperties()
            .map(|t| {
                let end = t.EndTime().map(|d| d.Duration as f64 / 1e7).unwrap_or(0.0);
                let pos = t.Position().map(|d| d.Duration as f64 / 1e7).unwrap_or(0.0);
                // WinRT DateTime counts 100ns ticks from 1601-01-01; unix time
                // starts 11644473600 seconds later.
                let upd = t
                    .LastUpdatedTime()
                    .map(|d| {
                        let unix_100ns = d.UniversalTime - 116_444_736_000_000_000;
                        if unix_100ns <= 0 { 0 } else { (unix_100ns / 10_000) as u128 }
                    })
                    .unwrap_or(0);
                (end, pos, upd)
            })
            .unwrap_or((0.0, 0.0, 0));

        Some(NowPlaying {
            source_app,
            title,
            artist: props.Artist().map(|s| s.to_string_lossy()).unwrap_or_default(),
            album_title: props.AlbumTitle().map(|s| s.to_string_lossy()).unwrap_or_default(),
            album_artist: props.AlbumArtist().map(|s| s.to_string_lossy()).unwrap_or_default(),
            track_number: props.TrackNumber().unwrap_or(0),
            album_track_count: props.AlbumTrackCount().unwrap_or(0),
            playback_type: props
                .PlaybackType()
                .and_then(|r| r.Value())
                .map(|v| format!("{:?}", v))
                .unwrap_or_default(),
            duration_sec,
            position_sec,
            position_updated_ms,
            playing,
        })
    }
}

/// Poll interval. 2s is far finer than any track and costs nothing measurable;
/// it is what the PowerShell collector has been running at.
pub const POLL: Duration = Duration::from_secs(2);
