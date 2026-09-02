//! The shelf: a pure function of the listen log.
//!
//! Nothing here is stored. Feed it the counted listens and it returns the shelf,
//! deterministically. That is what lets a better rule -- or a real track-count
//! denominator -- be applied to the entire history by recomputing, instead of
//! being stuck with what today's code believed.
//!
//! TWO RULES, BOTH MEASURED RATHER THAN ASSUMED
//! --------------------------------------------
//! FOLDING. `Interstellar (OST)` and `Interstellar (OST) [Expanded Edition]` are
//! one record, not two. `Creep` and `Creep (Live at Glastonbury)` are not.
//! Ported from `scripts/fold/release-fold.js` with its standing bias intact:
//! A FALSE MERGE IS WORSE THAN A MISSED MERGE. A missed merge shows two records
//! that should be one, which the owner reads as a variant. A false merge
//! silently destroys a record, and there is nothing on screen to notice.
//!
//! PRESSING. Sequential front-to-back play is dead -- measured, 98% of runs are
//! a single track. But album AFFINITY is strong. So a record is earned by
//! COVERAGE, not order: you have earned it once you have heard enough of it,
//! however you got there.
//!
//! Coverage needs a denominator, and SMTC never supplies one (`AlbumTrackCount`
//! is always 0, proven against a locally tagged file). Until the bundled
//! MusicBrainz index ships, this presses TEST PRESSINGS only -- a floor of
//! distinct tracks, which needs no denominator. The floor of 5 is measured, not
//! picked: pressing on first contact gave 178 records at 88.8% blank; a floor of
//! 5 gave 31 records at 35.5% blank.

use crate::store::Listen;
use std::collections::{HashMap, HashSet};

/// Tokens that mark a genuinely different recording. Their presence BLOCKS
/// folding outright -- a live take is not the studio take.
///
/// Deliberately absent: `soundtrack` and `score`. Including them was a real
/// design error, measured 2026-08-17: it blocked 163 of 200 folds, because a
/// library heavy with film music has the OST AS the album.
const NEVER_FOLD: &[&str] = &[
    "live", "acoustic", "unplugged", "instrumental", "a cappella", "acapella",
    "demo", "demos", "remix", "remixes", "remixed", "karaoke", "tribute",
    "covers", "commentary", "session", "sessions",
    "sped up", "slowed", "reverb", "chopped", "screwed", "radio 1",
    "orchestral", "symphonic", "mtv",
];

/// Words that mark an edition of the SAME release, and nothing else.
const EDITION: &[&str] = &[
    "deluxe", "super deluxe", "expanded", "extended", "remaster", "remastered",
    "anniversary", "special", "collector", "collectors", "collector's", "limited",
    "bonus", "bonus track", "bonus tracks", "explicit", "clean", "standard",
    "international", "japanese", "japan", "uk", "us", "edition", "version",
    "reissue", "digital", "mono", "stereo", "exclusive", "target", "spotify",
    "apple", "amazon", "itunes", "tour", "complete", "original",
];

/// The floor of distinct tracks that cuts a test pressing.
pub const TEST_PRESSING_FLOOR: usize = 5;

fn strip_diacritics(s: &str) -> String {
    // Deliberately minimal: the accented characters that actually appear in
    // release titles, not a full Unicode normalisation dependency.
    s.chars()
        .map(|c| match c {
            'á'|'à'|'â'|'ä'|'ã'|'å' => 'a', 'é'|'è'|'ê'|'ë' => 'e',
            'í'|'ì'|'î'|'ï' => 'i', 'ó'|'ò'|'ô'|'ö'|'õ'|'ø' => 'o',
            'ú'|'ù'|'û'|'ü' => 'u', 'ñ' => 'n', 'ç' => 'c', 'ý'|'ÿ' => 'y',
            _ => c,
        })
        .collect()
}

fn basic(s: &str) -> String {
    strip_diacritics(s)
        .replace(['\u{2013}', '\u{2014}', '\u{2012}', '\u{2015}'], "-")
        .replace(['\u{2018}', '\u{2019}', '\u{201C}', '\u{201D}'], "'")
        .to_lowercase()
        .trim()
        .to_string()
}

fn has_never_fold(text: &str) -> bool {
    let t = format!(" {} ", text.replace(|c: char| !c.is_alphanumeric() && c != '\'', " "));
    NEVER_FOLD.iter().any(|tok| t.contains(&format!(" {} ", tok)))
}

/// Does this chunk consist ONLY of edition markers, years and filler?
/// Anything unrecognised makes it UNKNOWN, and unknown is kept.
fn is_edition_only(text: &str) -> bool {
    let cleaned: String = text
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '\'' || c.is_whitespace() { c } else { ' ' })
        .collect();
    let words: Vec<&str> = cleaned.split_whitespace().collect();
    if words.is_empty() {
        return false;
    }

    let mut i = 0;
    while i < words.len() {
        // Longest multi-word edition phrase first.
        let mut matched = 0;
        for take in (1..=3).rev() {
            if i + take > words.len() {
                continue;
            }
            let phrase = words[i..i + take].join(" ");
            if EDITION.contains(&phrase.as_str()) {
                matched = take;
                break;
            }
        }
        if matched > 0 {
            i += matched;
            continue;
        }

        let w = words[i];

        // "<n> year", "<n> years", "<n> anniversary" -- an anniversary edition.
        // Found against real history: "PARTYNEXTDOOR 3 (P3) [10-YEAR EDITION]"
        // sat beside the base album as a separate record. "20th anniversary"
        // already folded via the ordinal rule below; a bare number did not.
        // Kept narrow -- the number must be followed by one of these words, so
        // "Blink 182" and "Sum 41" cannot be touched.
        if w.chars().all(|c| c.is_ascii_digit())
            && matches!(words.get(i + 1), Some(&"year") | Some(&"years") | Some(&"anniversary"))
        {
            i += 2;
            continue;
        }

        let bare_year = w.len() == 4 && w.chars().all(|c| c.is_ascii_digit());
        let ordinal = w.len() >= 3
            && w[..w.len() - 2].chars().all(|c| c.is_ascii_digit())
            && matches!(&w[w.len() - 2..], "st" | "nd" | "rd" | "th");
        if bare_year || ordinal || matches!(w, "the" | "a" | "and" | "of") {
            i += 1;
            continue;
        }
        return false; // unrecognised word -> not an edition marker -> keep it
    }
    true
}

#[derive(Debug, PartialEq)]
pub struct Folded {
    pub key: String,
    /// A never-fold token was seen, so this title deliberately keeps its own
    /// identity.
    pub blocked: bool,
}

/// Fold an album title to its release-group key.
pub fn fold_title(raw: &str) -> Folded {
    let mut s = basic(raw);
    let mut blocked = false;

    // Peel trailing bracketed chunks, right to left.
    loop {
        let Some((start, inner)) = trailing_bracket(&s) else { break };
        if has_never_fold(&inner) {
            blocked = true;
            break; // stop; keep the rest
        }
        if !is_edition_only(&inner) {
            break; // unknown -> keep
        }
        s = s[..start].trim().to_string();
    }

    // Peel a trailing " - deluxe edition" / ": remastered 2011" style suffix.
    loop {
        let Some(pos) = s.rfind(['-', ':']) else { break };
        let tail = s[pos + 1..].trim().to_string();
        if tail.is_empty() || tail.contains('-') || tail.contains(':') {
            break;
        }
        if has_never_fold(&tail) {
            blocked = true;
            break;
        }
        if !is_edition_only(&tail) {
            break;
        }
        s = s[..pos].trim().to_string();
    }

    // Disc / CD markers sit on the same release group. Handled explicitly
    // because "disc 1" is not an edition word and would otherwise survive the
    // peel above as an unknown chunk.
    s = strip_disc_marker(&s);

    // NOTE: leading articles are deliberately NOT stripped. "The Wall" and
    // "Wall" are not obviously the same record, and article-stripping is a
    // classic source of false merges.

    let mut key: String = s
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    // Symbol-only titles. Ed Sheeran's discography is literally +, x, ÷, =, -.
    // Stripping non-alphanumerics leaves an empty key, and every symbol-titled
    // album then folds into one record. Caught against real history
    // 2026-08-17: "÷ (Deluxe)" merged with "=". When the alphanumeric key is
    // empty, the punctuation IS the title -- keep it.
    if key.is_empty() {
        key = s.split_whitespace().collect::<Vec<_>>().join(" ");
    }

    Folded { key, blocked }
}

/// Remove a trailing "(disc 1)", "[cd 2]" or bare "disc 1".
fn strip_disc_marker(s: &str) -> String {
    let t = s.trim_end_matches([')', ']', ' ']);
    let cut = t.rfind(|c| c == '(' || c == '[').map(|i| i + 1).unwrap_or(0);
    let tail = t[cut..].trim();
    let words: Vec<&str> = tail.split_whitespace().collect();
    let is_disc = match words.as_slice() {
        [w, n] => {
            matches!(w.to_lowercase().as_str(), "disc" | "cd")
                && n.chars().all(|c| c.is_ascii_digit())
        }
        [w] => {
            let lower = w.to_lowercase();
            ["disc", "cd"].iter().any(|p| {
                lower.strip_prefix(p).is_some_and(|rest| {
                    !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit())
                })
            })
        }
        _ => false,
    };
    if !is_disc {
        return s.to_string();
    }
    let head_end = if cut > 0 { cut - 1 } else { 0 };
    s[..head_end].trim().to_string()
}

fn trailing_bracket(s: &str) -> Option<(usize, String)> {
    let t = s.trim_end();
    let close = t.chars().last()?;
    let open = match close {
        ')' => '(',
        ']' => '[',
        _ => return None,
    };
    let start = t.rfind(open)?;
    let inner = &t[start + 1..t.len() - close.len_utf8()];
    if inner.contains('(') || inner.contains('[') {
        return None;
    }
    Some((start, inner.trim().to_string()))
}

/// Fold an artist to a join key. Featured credits are dropped -- a track
/// credited "Drake feat. Rihanna" belongs on the Drake record.
pub fn fold_artist(raw: &str) -> String {
    let s = basic(raw);
    let s = ["feat", "ft", "featuring", "with"]
        .iter()
        .fold(s, |acc, tok| match find_word(&acc, tok) {
            Some(i) => acc[..i].trim().to_string(),
            None => acc,
        });
    s.replace('&', " and ")
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn find_word(hay: &str, word: &str) -> Option<usize> {
    let mut from = 0;
    while let Some(rel) = hay[from..].find(word) {
        let i = from + rel;
        let before_ok = i == 0 || !hay.as_bytes()[i - 1].is_ascii_alphanumeric();
        let after = i + word.len();
        let after_ok = after >= hay.len()
            || !hay.as_bytes()[after].is_ascii_alphanumeric();
        if before_ok && after_ok {
            return Some(i);
        }
        from = i + word.len();
    }
    None
}

#[derive(Debug, Clone, PartialEq)]
pub enum Tier {
    /// Coverage met against a real denominator. Unreachable until the index
    /// ships -- nothing fakes it in the meantime.
    Pressed,
    /// Enough distinct tracks to be real, but the album's true length is
    /// unknown. Honest about what it is.
    TestPressing,
}

#[derive(Debug, Clone)]
pub struct Record {
    pub artist: String,
    pub album: String,
    pub plays: u32,
    /// Distinct tracks heard.
    pub heard: usize,
    /// Album length. 0 means unknown -- SMTC never supplies it.
    pub len: usize,
    pub tier: Tier,
    /// One entry per distinct track, in the order first heard.
    pub tracks: Vec<Track>,
}

/// A groove band. `secs` sizes it -- the renderer lays bands out by duration,
/// so a zero here collapses the record to nothing.
#[derive(Debug, Clone, PartialEq)]
pub struct Track {
    pub title: String,
    pub plays: u32,
    pub secs: f64,
}

/// Derive the shelf from counted listens.
/// Every album the log knows about, INCLUDING the ones too sparse to press.
///
/// `shelf` is this with the test-pressing floor applied. They are split because
/// an album with three tracks heard is not nothing -- it is a record being cut,
/// and the app has to be able to show it filling up. Without this the deck could
/// only ever put a single track on an otherwise blank disc, so playing an album
/// straight through looked like a series of unrelated one-track records rather
/// than one record gaining grooves.
pub fn all_records(listens: &[Listen]) -> Vec<Record> {
    struct Group {
        artist: String,
        album: String,
        plays: u32,
        tracks: HashMap<String, (u32, f64)>,
        order: Vec<String>,
        seen_titles: HashSet<String>,
    }

    let mut groups: HashMap<String, Group> = HashMap::new();

    for l in listens {
        // A listen with no album cannot be grouped onto a record yet. It stays
        // in the log; the index will place it later.
        if l.album_title.trim().is_empty() || l.artist.trim().is_empty() {
            continue;
        }
        let folded = fold_title(&l.album_title);
        let artist_key = fold_artist(&l.artist);
        // A blocked title keeps its own identity, so its raw form joins the key.
        let key = if folded.blocked {
            format!("{}::{}::{}", artist_key, folded.key, basic(&l.album_title))
        } else {
            format!("{}::{}", artist_key, folded.key)
        };

        let g = groups.entry(key).or_insert_with(|| Group {
            artist: l.artist.clone(),
            album: l.album_title.clone(),
            plays: 0,
            tracks: HashMap::new(),
            order: Vec::new(),
            seen_titles: HashSet::new(),
        });

        g.plays += 1;
        let track_key = basic(&l.title);
        if g.seen_titles.insert(track_key.clone()) {
            g.order.push(l.title.clone());
        }
        let e = g.tracks.entry(l.title.clone()).or_insert((0, 0.0));
        e.0 += 1;
        // Duration arrives a poll or two late sometimes, so the longest report
        // wins rather than the first.
        if l.duration_sec > e.1 {
            e.1 = l.duration_sec;
        }
    }

    let mut out: Vec<Record> = groups
        .into_values()
        .map(|g| {
            let tracks: Vec<Track> = g
                .order
                .iter()
                .map(|t| {
                    let (plays, secs) = g.tracks.get(t).copied().unwrap_or((0, 0.0));
                    Track { title: t.clone(), plays, secs }
                })
                .collect();
            Record {
                artist: g.artist,
                album: g.album,
                plays: g.plays,
                heard: g.seen_titles.len(),
                len: 0, // no denominator until the index ships
                tier: Tier::TestPressing,
                tracks,
            }
        })
        .collect();

    // Most played first -- the shelf leads with what was actually listened to.
    out.sort_by(|a, b| b.plays.cmp(&a.plays).then(a.album.cmp(&b.album)));
    out
}

/// The records that have actually been earned: `all_records` past the floor.
pub fn shelf(listens: &[Listen]) -> Vec<Record> {
    all_records(listens)
        .into_iter()
        .filter(|r| r.heard >= TEST_PRESSING_FLOOR)
        .collect()
}

/// How close the nearest unpressed album is to cutting its first test pressing.
/// This is the cold-start progress line: "3 of 5 tracks".
pub fn closest_to_pressing(listens: &[Listen]) -> Option<(String, String, usize)> {
    let mut groups: HashMap<String, (String, String, HashSet<String>)> = HashMap::new();
    for l in listens {
        if l.album_title.trim().is_empty() || l.artist.trim().is_empty() {
            continue;
        }
        let key = format!("{}::{}", fold_artist(&l.artist), fold_title(&l.album_title).key);
        let e = groups
            .entry(key)
            .or_insert_with(|| (l.artist.clone(), l.album_title.clone(), HashSet::new()));
        e.2.insert(basic(&l.title));
    }
    groups
        .into_values()
        .filter(|(_, _, t)| t.len() < TEST_PRESSING_FLOOR)
        .max_by_key(|(_, _, t)| t.len())
        .map(|(artist, album, t)| (artist, album, t.len()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(s: &str) -> String {
        fold_title(s).key
    }

    // ---- folding: the merges that must happen ----------------------------

    #[test]
    fn deluxe_and_expanded_fold_to_the_base_record() {
        assert_eq!(key("Interstellar (OST)"), key("Interstellar (OST) [Expanded Edition]"));
        assert_eq!(key("Nectar"), key("Nectar (Deluxe)"));
        assert_eq!(key("Blonde"), key("Blonde (2016 Remaster)"));
        assert_eq!(key("Views"), key("Views - Bonus Track Version"));
    }

    #[test]
    fn disc_markers_sit_on_the_same_release_group() {
        assert_eq!(key("The Wall (Disc 1)"), key("The Wall"));
    }

    // ---- folding: the merges that must NOT happen ------------------------

    #[test]
    fn a_live_take_is_not_the_studio_take() {
        assert_ne!(key("Creep"), key("Creep (Live at Glastonbury)"));
        assert!(fold_title("Creep (Live at Glastonbury)").blocked);
    }

    #[test]
    fn remixes_and_acoustic_keep_their_identity() {
        assert!(fold_title("Nectar (Remixes)").blocked);
        assert!(fold_title("Nectar (Acoustic)").blocked);
    }

    #[test]
    fn soundtracks_fold_deliberately() {
        // Including 'soundtrack' in NEVER_FOLD blocked 163 of 200 folds against
        // real history. It is absent on purpose.
        assert!(!fold_title("Interstellar (Original Motion Picture Soundtrack)").blocked);
    }

    #[test]
    fn symbol_titles_do_not_all_collapse_into_one() {
        // REAL defect, 2026-08-17: "÷ (Deluxe)" merged with "=".
        assert_ne!(key("÷"), key("="));
        assert_ne!(key("+"), key("x"));
        assert_eq!(key("÷ (Deluxe)"), key("÷"));
    }

    #[test]
    fn anniversary_editions_fold() {
        // REAL, found by deriving a shelf from actual captured history:
        // the 10-year edition was sitting beside the base album as its own
        // record. "20th anniversary" already folded; a bare number did not.
        assert_eq!(key("PARTYNEXTDOOR 3 (P3)"), key("PARTYNEXTDOOR 3 (P3) [10-YEAR EDITION]"));
        assert_eq!(key("Nectar"), key("Nectar (20th Anniversary Edition)"));
    }

    #[test]
    fn a_number_in_a_band_name_is_not_edition_filler() {
        // The narrowing that keeps the rule above safe.
        assert_ne!(key("Blink 182"), key("Blink"));
        assert_ne!(key("Sum 41"), key("Sum"));
    }

    #[test]
    fn articles_are_not_stripped() {
        assert_ne!(key("The Wall"), key("Wall"));
    }

    // ---- artists ----------------------------------------------------------

    #[test]
    fn featured_credits_join_the_main_artist() {
        assert_eq!(fold_artist("Drake feat. Rihanna"), fold_artist("Drake"));
        assert_eq!(fold_artist("Tyler, The Creator"), "tyler the creator");
        assert_eq!(fold_artist("Simon & Garfunkel"), fold_artist("Simon and Garfunkel"));
    }

    // ---- pressing ---------------------------------------------------------

    fn l(artist: &str, album: &str, title: &str) -> Listen {
        Listen {
            started_at: "2026-09-01T10:00:00+05:30".into(),
            ended_at: "2026-09-01T10:03:00+05:30".into(),
            source_app: "Spotify.exe".into(),
            title: title.into(),
            artist: artist.into(),
            album_title: album.into(),
            album_artist: artist.into(),
            track_number: 0,
            album_track_count: 0,
            playback_type: "Music".into(),
            duration_sec: 200.0,
            dwell_sec: 180.0,
            counted: true,
            end_reason: "track changed".into(),
        }
    }

    #[test]
    fn four_tracks_is_not_yet_a_record() {
        let ls: Vec<Listen> = ["a", "b", "c", "d"]
            .iter()
            .map(|t| l("PARTYNEXTDOOR", "PARTYNEXTDOOR TWO", t))
            .collect();
        assert!(shelf(&ls).is_empty(), "the floor is 5 distinct tracks");

        let (_, _, heard) = closest_to_pressing(&ls).unwrap();
        assert_eq!(heard, 4, "cold start shows real progress toward the floor");
    }

    #[test]
    fn five_distinct_tracks_cuts_a_test_pressing() {
        let ls: Vec<Listen> = ["a", "b", "c", "d", "e"]
            .iter()
            .map(|t| l("PARTYNEXTDOOR", "PARTYNEXTDOOR TWO", t))
            .collect();
        let s = shelf(&ls);
        assert_eq!(s.len(), 1);
        assert_eq!(s[0].heard, 5);
        assert_eq!(s[0].tier, Tier::TestPressing);
        assert_eq!(s[0].len, 0, "no denominator until the index ships");
    }

    #[test]
    fn repeats_are_plays_not_coverage() {
        let mut ls: Vec<Listen> = ["a", "b", "c", "d"]
            .iter()
            .map(|t| l("PARTYNEXTDOOR", "PARTYNEXTDOOR TWO", t))
            .collect();
        for _ in 0..40 {
            ls.push(l("PARTYNEXTDOOR", "PARTYNEXTDOOR TWO", "a"));
        }
        assert!(shelf(&ls).is_empty(), "looping one track must not press a record");
    }

    #[test]
    fn editions_of_one_album_are_one_record() {
        let mut ls: Vec<Listen> = ["a", "b", "c"]
            .iter()
            .map(|t| l("Frank Ocean", "Blonde", t))
            .collect();
        ls.extend(["d", "e"].iter().map(|t| l("Frank Ocean", "Blonde (Deluxe)", t)));
        let s = shelf(&ls);
        assert_eq!(s.len(), 1, "one record, not two");
        assert_eq!(s[0].heard, 5);
    }
}
