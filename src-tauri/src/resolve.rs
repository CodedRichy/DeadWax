//! Turn a raw Windows media session into something a record can be pressed from.
//!
//! Rust port of `scripts/smtc/resolve.js`. The JS stays the reference and keeps
//! its own suite; this carries the same fixtures so the two cannot silently
//! diverge. Port the TESTS, not the code -- a port that only copies logic has
//! nothing to prove it landed.
//!
//! Two jobs, in order:
//!
//!   1. `is_music`     -- is this even music? Chrome publishes ANY page with
//!                        audio to the media session. A Minecraft server page
//!                        appeared beside Spotify during the 2026-08-17 capture.
//!                        Left alone the app presses a record for a web page.
//!
//!   2. `unpack_title` -- browser tabs cram everything into `title` and leave
//!                        `album_title` empty, and on SoundCloud the artist
//!                        field is the UPLOADER. Both have to be undone before
//!                        the index can find an album.
//!
//! STANDING BIAS: prefer returning nothing over returning something wrong.
//! A track we fail to parse is a missed play. A track we parse WRONG presses a
//! record that should not exist, or adds wear to the wrong disc. The first is
//! invisible; the second is a defect the owner can see on their shelf.

use regex::{Regex, RegexBuilder};
use std::sync::LazyLock;

// ===========================================================================
// 1. IS THIS MUSIC?
// ===========================================================================

/// Sources that only ever publish real music. Trusted without further checks --
/// their metadata comes from a catalogue, not a page title.
const MUSIC_APPS: &[&str] = &[
    "spotify",
    "zunemusic", // Windows Media Player (modern)
    "apple",     // Apple Music / iTunes
    "tidal",
    "amazon",
    "foobar2000",
    "musicbee",
    "aimp",
    "winamp",
    "vlc",
    "deezer",
    "youtubemusic", // the desktop wrapper, not the browser tab
];

/// Browsers publish everything. Neither trusted nor rejected outright -- they
/// get the content checks below.
const BROWSERS: &[&str] = &[
    "chrome", "msedge", "edge", "firefox", "brave", "opera", "vivaldi", "zen",
];

/// Shapes that appear in web page titles and never in a track name.
static NOT_MUSIC_TITLE: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    ci(&[
        r"\|\s*[a-z0-9-]+\.(com|net|org|io|gg|tv)\b",
        r"\bserver\b.*\bminecraft\b",
        r"\bminecraft\b.*\bserver\b",
        r"\b(dashboard|console|admin panel|settings|login|sign in)\b",
        r"\b(google (docs|sheets|drive|meet)|notion|figma|jira|gmail|outlook)\b",
        r"\b(stack overflow|github|reddit|twitter|facebook)\b",
        r"\bpodcast\b",
        r"\b(tutorial|how to|full course|lecture|documentary)\b",
        r"\b(stream|streaming) (now|live)\b",
    ])
});

fn ci(patterns: &[&str]) -> Vec<Regex> {
    patterns
        .iter()
        .map(|p| {
            RegexBuilder::new(p)
                .case_insensitive(true)
                .build()
                .expect("static pattern must compile")
        })
        .collect()
}

/// A media session as captured, named the way SMTC names things.
#[derive(Debug, Clone, Default)]
pub struct Session {
    pub source_app: String,
    pub title: String,
    pub artist: String,
    pub album_title: String,
    pub playback_type: String,
    pub duration_sec: f64,
}

#[derive(Debug, PartialEq, Clone, Copy)]
pub enum Confidence {
    High,
    Medium,
    Low,
}

#[derive(Debug, PartialEq)]
pub struct Parsed {
    pub artist: String,
    pub track: String,
    pub confidence: Confidence,
}

#[derive(Debug, PartialEq)]
pub enum Verdict {
    /// Pressable. `album` is None when the source did not supply one and the
    /// bundled index has to resolve it.
    Ok {
        artist: String,
        track: String,
        album: Option<String>,
        confidence: Confidence,
    },
    /// Refused, with the reason kept. Refusals are DATA -- they measure how much
    /// of a capture is unusable, which is one of the numbers this exists to
    /// find out. Never silently dropped.
    Refused(&'static str),
}

/// Decide whether a session should be allowed to press a record.
pub fn is_music(s: &Session) -> Result<(), &'static str> {
    let app = s.source_app.to_lowercase();
    let title = s.title.trim();
    let artist = s.artist.trim();

    if title.is_empty() {
        return Err("no title");
    }

    // A dedicated music application is trusted outright.
    if MUSIC_APPS.iter().any(|m| app.contains(m)) {
        return Ok(());
    }

    let is_browser = BROWSERS.iter().any(|b| app.contains(b));

    // An unknown source with a proper album is almost certainly a player we have
    // not listed. Accept it -- the alternative is silently ignoring players.
    if !is_browser && !s.album_title.is_empty() {
        return Ok(());
    }

    // From here on: a browser tab, or an unknown app with no album.

    // playback_type is a weak signal alone -- a YouTube music video reports as
    // Music, but so does anything else a page chooses to declare. Useful only
    // in the negative direction.
    if s.playback_type.eq_ignore_ascii_case("video") {
        return Err("declared as video");
    }

    if NOT_MUSIC_TITLE.iter().any(|re| re.is_match(title)) {
        return Err("page-title shape");
    }

    // No artist and no separator means there is nothing to press FROM, even if
    // it happens to be music.
    static DASH: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s[-–—]\s").unwrap());
    if artist.is_empty() && !DASH.is_match(title) {
        return Err("no artist and no parseable title");
    }

    // Very short media is a UI sound, a preview or a page, not a track.
    if s.duration_sec > 0.0 && s.duration_sec < 45.0 {
        return Err("too short to be a track");
    }

    Ok(())
}

// ===========================================================================
// 2. UNPACK A BROWSER TITLE
// ===========================================================================

/// Bracketed suffixes that are upload furniture, never part of a track name.
static UPLOAD_JUNK: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    ci(&[
        r"official\s+(music\s+)?video",
        r"official\s+(audio|lyric|visuali[sz]er|version)",
        r"^\s*(audio|video|visuali[sz]er|lyrics?|lyric video)\s*$",
        r"^\s*(hd|hq|4k|8k|1080p|720p|full hd)\s*$",
        r"^\s*(m/?v|mv)\s*$",
        r"free\s+download",
        r"out\s+now",
        r"prod\.?\s+by",
        r"^\s*explicit\s*$",
        r"^\s*clean\s*$",
        r"\bncs\s+release\b",
        r"copyright\s+free",
        r"^\s*\d{4}\s*$", // a bare year in brackets
    ])
});

/// Shapes that appear in a CHANNEL name and never in an artist credit. Used
/// only as a last-resort veto -- see step 3 of `unpack_title`. Deliberately
/// narrow: a real artist name must never match.
static UPLOADER_SHAPE: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    ci(&[
        r"https?://",
        r"\bwww\.[a-z0-9-]+\.[a-z]{2,}",
        r"[a-z0-9-]+\.(com|net|org|io|ml|tk|co)\b",
        r"[®™]",
        r"[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]", // emoji and pictographs
        r"\b(uploads?|archive|vault|leaks?|unreleased|topic)\b",
        r"\bhidden gems\b",
    ])
});

fn looks_like_uploader(name: &str) -> bool {
    UPLOADER_SHAPE.iter().any(|re| re.is_match(name))
}

fn is_junk_chunk(text: &str) -> bool {
    let t = text.trim();
    UPLOAD_JUNK.iter().any(|re| re.is_match(t))
}

/// Remove bracketed upload furniture, keeping anything unrecognised.
///
/// Scans EVERY bracketed chunk rather than stopping at the first unknown one.
/// Stopping was the first implementation and it was wrong: junk routinely sits
/// after a meaningful bracket --
///   "Drake - Work (feat. Rihanna) (Official Audio)"
/// -- so halting at "(feat. Rihanna)" left "(Official Audio)" glued on.
/// Continuing is safe because only chunks on the explicit junk list are ever
/// removed; unknown chunks are left exactly where they are.
pub fn strip_junk_brackets(title: &str) -> String {
    static BRACKETED: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"\s*[\(\[]([^()\[\]]*)[\)\]]").unwrap());
    static SPACES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());

    let stripped = BRACKETED.replace_all(title, |caps: &regex::Captures| {
        if is_junk_chunk(&caps[1]) {
            " ".to_string()
        } else {
            caps[0].to_string()
        }
    });
    SPACES.replace_all(stripped.trim(), " ").to_string()
}

/// Channel/uploader suffixes after a pipe. "Track | Artist" and
/// "Track | SomeChannel" are indistinguishable, so the pipe tail is dropped
/// rather than guessed at.
fn strip_pipe_tail(s: &str) -> &str {
    s.split('|').next().unwrap_or(s).trim()
}

/// Recover artist and track from a session.
pub fn unpack_title(title: &str, artist_field: &str) -> Option<Parsed> {
    let artist_field = artist_field.trim();
    let title = strip_junk_brackets(strip_pipe_tail(title.trim()));
    let title = title.trim();
    if title.is_empty() {
        return None;
    }

    // STEP 1 -- the artist field is repeated as a prefix of the title. This is
    // the shape YouTube produced in the real capture, and the one case where
    // the artist field is confirmed by a second source:
    //   artist: "PARTYNEXTDOOR"
    //   title : "PARTYNEXTDOOR - MAKE IT TO THE MORNING (Official Visualizer)"
    if !artist_field.is_empty() {
        let pattern = format!(r"^\s*{}\s*[-–—:]\s*", regex::escape(artist_field));
        if let Ok(prefix) = RegexBuilder::new(&pattern).case_insensitive(true).build() {
            if prefix.is_match(title) {
                let track = prefix.replace(title, "").trim().to_string();
                if !track.is_empty() {
                    return Some(Parsed {
                        artist: artist_field.to_string(),
                        track,
                        confidence: Confidence::High,
                    });
                }
            }
        }
    }

    // STEP 2 -- the title splits on a dash, so the title carries the credit and
    // the artist field does not. TRUST THE TITLE AND DISCARD THE FIELD.
    //
    // This inversion is the point of the whole function. On SoundCloud and on
    // unofficial YouTube uploads the artist field is the UPLOADER, and taking it
    // at face value -- which the JS did until 2026-08-19 -- files real records
    // under channel names. Captured that day: "hidden gems", "bc",
    // "Prince Elliot [emoji]" and "The New Industry(R)" were all credited as
    // artists for four PARTYNEXTDOOR tracks. The title had it right every time.
    //
    // Whitespace is required AFTER the dash but optional before it, because
    // "PARTYNEXTDOOR- Something New" is a real captured shape. Requiring it
    // after is what still keeps "Jay-Z" and "Wu-Tang" intact -- neither has a
    // space following the hyphen, so neither can match.
    static SPLIT: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"^(.+?)\s*[-–—]\s+(.+)$").unwrap());
    if let Some(caps) = SPLIT.captures(title) {
        let a = caps[1].trim();
        let t = caps[2].trim();
        // A split that produces an empty or absurd side is not a split.
        if !a.is_empty() && !t.is_empty() && a.chars().count() < 90 && t.chars().count() < 120 {
            // KNOWN LIMIT, deliberately not guessed at: some uploads are
            // reversed -- "Whatever You Say - PartyNextDoor", real capture, same
            // day. Nothing in the string says which side is which, so
            // conventional ARTIST - TRACK order is assumed and confidence stays
            // Medium. The bundled index is the right place to arbitrate: it can
            // try both orders and keep whichever matches a real release.
            // Guessing here would only hide the problem.
            return Some(Parsed {
                artist: a.to_string(),
                track: t.to_string(),
                confidence: Confidence::Medium,
            });
        }
    }

    // STEP 3 -- no split. The artist field is the only candidate left, and it is
    // unconfirmed by anything else.
    if !artist_field.is_empty() {
        // An unconfirmed field that reads like a channel is worse than nothing
        // -- it presses a record credited to the uploader. Refuse instead.
        if looks_like_uploader(artist_field) {
            return None;
        }
        return Some(Parsed {
            artist: artist_field.to_string(),
            track: title.to_string(),
            confidence: Confidence::Low,
        });
    }

    None
}

/// Full pipeline: raw session -> pressable, or a stated refusal.
pub fn resolve(s: &Session) -> Verdict {
    if let Err(reason) = is_music(s) {
        return Verdict::Refused(reason);
    }

    // A trusted source with a real album needs no unpacking at all.
    if !s.album_title.is_empty() && !s.artist.is_empty() {
        return Verdict::Ok {
            artist: s.artist.clone(),
            track: s.title.clone(),
            album: Some(s.album_title.clone()),
            confidence: Confidence::High,
        };
    }

    match unpack_title(&s.title, &s.artist) {
        None => Verdict::Refused("could not parse artist and track"),
        Some(p) => Verdict::Ok {
            artist: p.artist,
            track: p.track,
            album: None, // the bundled index resolves this
            confidence: p.confidence,
        },
    }
}

// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    /// Every case marked REAL was captured from this machine and is reproduced
    /// verbatim from the JS suite. If the port drifts, these break.
    fn sess(app: &str, title: &str, artist: &str, album: &str, ty: &str, dur: f64) -> Session {
        Session {
            source_app: app.into(),
            title: title.into(),
            artist: artist.into(),
            album_title: album.into(),
            playback_type: ty.into(),
            duration_sec: dur,
        }
    }

    // ---- is it music? -----------------------------------------------------

    #[test]
    fn spotify_is_trusted() {
        // REAL, 2026-08-17
        let s = sess("Spotify.exe", "Bout It", "PARTYNEXTDOOR", "PARTYNEXTDOOR TWO", "Music", 205.0);
        assert!(is_music(&s).is_ok());
    }

    #[test]
    fn local_player_is_trusted() {
        // REAL -- the tagged MP3 that proved AlbumTrackCount is always 0
        let s = sess(
            "Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic",
            "Denominator Test", "Test Artist", "Test Album", "Music", 45.0,
        );
        assert!(is_music(&s).is_ok());
    }

    #[test]
    fn minecraft_server_page_rejected() {
        // REAL -- the case that prompted this whole module
        let s = sess("Chrome", "Server | Aternos | Free Minecraft Server", "", "", "Music", 34.0);
        assert_eq!(is_music(&s), Err("page-title shape"));
    }

    #[test]
    fn youtube_music_video_passes() {
        // REAL
        let s = sess(
            "Chrome",
            "PARTYNEXTDOOR - MAKE IT TO THE MORNING (Official Visualizer)",
            "PARTYNEXTDOOR", "", "Music", 168.0,
        );
        assert!(is_music(&s).is_ok());
    }

    #[test]
    fn podcast_rejected() {
        let s = sess("Chrome", "Ep. 402 - The Daily Podcast", "", "", "", 3200.0);
        assert_eq!(is_music(&s), Err("page-title shape"));
    }

    #[test]
    fn tutorial_rejected() {
        let s = sess("Chrome", "How To Build A React App - Full Course", "", "", "", 7200.0);
        assert_eq!(is_music(&s), Err("page-title shape"));
    }

    #[test]
    fn declared_video_rejected() {
        let s = sess("Chrome", "Some Artist - Some Song", "", "", "Video", 200.0);
        assert_eq!(is_music(&s), Err("declared as video"));
    }

    #[test]
    fn short_clip_rejected() {
        let s = sess("Chrome", "Artist - Song", "", "", "", 12.0);
        assert_eq!(is_music(&s), Err("too short to be a track"));
    }

    #[test]
    fn bare_page_title_rejected() {
        let s = sess("Chrome", "Gmail", "", "", "", 300.0);
        assert_eq!(is_music(&s), Err("page-title shape"));
    }

    #[test]
    fn unlisted_player_with_album_accepted() {
        let s = sess("SomeNewPlayer.exe", "Track", "Artist", "An Album", "", 200.0);
        assert!(is_music(&s).is_ok());
    }

    // ---- unpacking --------------------------------------------------------

    fn parsed(artist: &str, track: &str, c: Confidence) -> Option<Parsed> {
        Some(Parsed { artist: artist.into(), track: track.into(), confidence: c })
    }

    #[test]
    fn youtube_artist_repeated_as_prefix() {
        // REAL
        assert_eq!(
            unpack_title("PARTYNEXTDOOR - MAKE IT TO THE MORNING (Official Visualizer)", "PARTYNEXTDOOR"),
            parsed("PARTYNEXTDOOR", "MAKE IT TO THE MORNING", Confidence::High)
        );
    }

    #[test]
    fn dash_split_without_artist_field() {
        assert_eq!(
            unpack_title("Daft Punk - Around The World (Official Video)", ""),
            parsed("Daft Punk", "Around The World", Confidence::Medium)
        );
    }

    #[test]
    fn pipe_tail_dropped() {
        assert_eq!(
            unpack_title("Burial - Archangel | Hyperdub", ""),
            parsed("Burial", "Archangel", Confidence::Medium)
        );
    }

    #[test]
    fn stacked_junk_brackets() {
        assert_eq!(
            unpack_title("Artist - Song (Official Music Video) [HD]", ""),
            parsed("Artist", "Song", Confidence::Medium)
        );
    }

    #[test]
    fn feat_is_kept_it_is_part_of_the_track() {
        assert_eq!(
            unpack_title("Drake - Work (feat. Rihanna) (Official Audio)", ""),
            parsed("Drake", "Work (feat. Rihanna)", Confidence::Medium)
        );
    }

    #[test]
    fn live_is_kept_it_is_a_different_recording() {
        assert_eq!(
            unpack_title("Radiohead - Creep (Live at Glastonbury)", ""),
            parsed("Radiohead", "Creep (Live at Glastonbury)", Confidence::Medium)
        );
    }

    #[test]
    fn unconfirmed_artist_field_is_low_confidence() {
        assert_eq!(
            unpack_title("Some Song", "Some Artist"),
            parsed("Some Artist", "Some Song", Confidence::Low)
        );
    }

    #[test]
    fn unparseable_returns_none_never_a_guess() {
        assert_eq!(unpack_title("aternos", ""), None);
    }

    // ---- THE UPLOADER CASES ----------------------------------------------
    // All REAL, captured 2026-08-19 from SoundCloud and YouTube through Chrome.
    // Every one wrote a record credited to a channel before this was fixed.
    // One artist, four wrong names.

    #[test]
    fn real_uploader_hidden_gems_loses_to_the_title() {
        assert_eq!(
            unpack_title("PARTYNEXTDOOR- Something New", "hidden gems"),
            parsed("PARTYNEXTDOOR", "Something New", Confidence::Medium)
        );
    }

    #[test]
    fn real_uploader_bc_loses_to_the_title() {
        assert_eq!(
            unpack_title("PARTYNEXTDOOR - Meghan Interlude", "bc"),
            parsed("PARTYNEXTDOOR", "Meghan Interlude", Confidence::Medium)
        );
    }

    #[test]
    fn real_emoji_channel_loses_and_bare_year_stripped() {
        assert_eq!(
            unpack_title("PARTYNEXTDOOR- WANT ME (UNRELEASED) (2020)", "Prince Elliot \u{1F3A7}"),
            parsed("PARTYNEXTDOOR", "WANT ME (UNRELEASED)", Confidence::Medium)
        );
    }

    #[test]
    fn real_url_channel_loses_to_the_title() {
        assert_eq!(
            unpack_title(
                "PARTYNEXTDOOR - 647 (Company) [Reference Track For Drake's Company]",
                "The New Industry® (www.thenewindustry.ml)"
            ),
            parsed(
                "PARTYNEXTDOOR",
                "647 (Company) [Reference Track For Drake's Company]",
                Confidence::Medium
            )
        );
    }

    #[test]
    fn real_reversed_upload_is_split_conventionally() {
        // The one this layer gets WRONG on purpose. Asserted as-is so the day it
        // changes, it changes deliberately.
        assert_eq!(
            unpack_title("Whatever You Say - PartyNextDoor (cut the end part off lol)", "a.babyy ✨"),
            parsed(
                "Whatever You Say",
                "PartyNextDoor (cut the end part off lol)",
                Confidence::Medium
            )
        );
    }

    #[test]
    fn uploader_shaped_field_with_no_split_is_refused() {
        assert_eq!(unpack_title("Some Leaked Thing", "Prince Elliot \u{1F3A7}"), None);
    }

    #[test]
    fn dash_with_no_leading_space_still_splits() {
        assert_eq!(
            unpack_title("Artist Name- Track Name", ""),
            parsed("Artist Name", "Track Name", Confidence::Medium)
        );
    }

    #[test]
    fn jay_z_survives_the_loosened_split() {
        assert_eq!(
            unpack_title("Jay-Z - Song Title", ""),
            parsed("Jay-Z", "Song Title", Confidence::Medium)
        );
    }

    #[test]
    fn wu_tang_survives_with_no_separator() {
        assert_eq!(unpack_title("Wu-Tang Clan Protect Ya Neck", ""), None);
    }

    // ---- full pipeline ----------------------------------------------------

    #[test]
    fn spotify_resolves_with_its_own_album() {
        let s = sess("Spotify.exe", "Bout It", "PARTYNEXTDOOR", "PARTYNEXTDOOR TWO", "Music", 205.0);
        assert_eq!(
            resolve(&s),
            Verdict::Ok {
                artist: "PARTYNEXTDOOR".into(),
                track: "Bout It".into(),
                album: Some("PARTYNEXTDOOR TWO".into()),
                confidence: Confidence::High,
            }
        );
    }

    #[test]
    fn youtube_resolves_album_left_for_the_index() {
        let s = sess(
            "Chrome",
            "PARTYNEXTDOOR - MAKE IT TO THE MORNING (Official Visualizer)",
            "PARTYNEXTDOOR", "", "Music", 168.0,
        );
        assert_eq!(
            resolve(&s),
            Verdict::Ok {
                artist: "PARTYNEXTDOOR".into(),
                track: "MAKE IT TO THE MORNING".into(),
                album: None,
                confidence: Confidence::High,
            }
        );
    }

    #[test]
    fn minecraft_page_refused_with_a_reason() {
        let s = sess("Chrome", "Server | Aternos | Free Minecraft Server", "", "", "Music", 34.0);
        assert_eq!(resolve(&s), Verdict::Refused("page-title shape"));
    }
}
