//! Serves the page to the app's WebView, and answers its two questions.
//!
//! WHY AN HTTP SERVER INSIDE THE APP
//! ---------------------------------
//! `index.html` already defines both contracts it needs, and has since the web
//! build: it reads `window.DEADWAX` for the shelf and polls `GET /api/now` for
//! what is playing. `scripts/serve.js` proved that arrangement works. Rust
//! replaces that process; the page does not change.
//!
//! It binds 127.0.0.1 only. This is not a server in the sense the project
//! rules out -- it is in-process, loopback-only, and dies with the app. Nothing
//! the user owns depends on anything remote.
//!
//! ONE FILE, TWO BUILDS
//! --------------------
//! The public GitHub Pages build ships with `const PUBLIC = true`, which makes
//! the page ignore `window.DEADWAX` and never call `/api/now` -- correct, since
//! a shared URL must carry neither a real person's listening history nor a
//! localhost dependency. The desktop app serves the SAME file with that flag
//! flipped and the shelf injected. No fork, no second copy to keep in step.

use crate::press::Record;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// What the page needs to know about what is playing right now.
///
/// `position`/`duration` are what make pause, resume and seek visible at all.
/// Without them the page could only ever know WHICH track was on, never where
/// in it -- so the arm free-ran on a timer of its own and disagreed with the
/// room the moment anything was paused or scrubbed. SMTC's position is a
/// SNAPSHOT, not a clock: it does not tick between updates, so `sampled_ms`
/// travels with it and the page extrapolates from there.
#[derive(Clone, Default)]
pub struct Live {
    pub playing: bool,
    pub artist: String,
    pub track: String,
    pub album: String,
    pub position: f64,
    pub duration: f64,
    pub sampled_ms: u128,
}

pub struct State {
    pub root: PathBuf,
    /// Real album track counts by fold key, when anything knows them. Empty is
    /// the honest default -- see the `len` note in `shelf_json`.
    pub lens: Mutex<std::collections::HashMap<String, u32>>,
    pub shelf: Mutex<Vec<Record>>,
    /// Every album the log knows, floor or no floor. The shelf is the earned
    /// subset; this is what lets the deck show a record being cut.
    pub pending: Mutex<Vec<Record>>,
    pub live: Mutex<Live>,
}

fn json_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

/// Groove pitch stand-in, 0..1.
///
/// The real value comes from `GrooveSource` -- loudness measured off the audio
/// -- which is explicitly out of this slice (it needs WASAPI loopback). Until
/// then this is a STABLE HASH OF THE TRACK TITLE, not an analysis, and it is
/// labelled as such rather than dressed up as one. It only has to be
/// deterministic and varied so adjacent bands do not render identically; the
/// wear on top of it is the part that is actually earned.
fn placeholder_loudness(title: &str) -> f64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in title.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    0.25 + ((h >> 11) % 1000) as f64 / 1000.0 * 0.55
}

fn shelf_json(
    root: &Path,
    records: &[Record],
    lens: &std::collections::HashMap<String, u32>,
) -> String {
    let items: Vec<String> = records
        .iter()
        .map(|r| {
            let tracks: Vec<String> = r
                .tracks
                .iter()
                .map(|t| {
                    format!(
                        r#"{{"t":"{}","sec":{:.0},"plays":{},"loud":{:.4}}}"#,
                        json_escape(&t.title),
                        t.secs,
                        t.plays,
                        placeholder_loudness(&t.title)
                    )
                })
                .collect();
            format!(
                r#"{{"artist":"{}","album":"{}","plays":{},"heard":{},"len":{},"art":{},"tracks":[{}]}}"#,
                json_escape(&r.artist),
                json_escape(&r.album),
                r.plays,
                r.heard,
                // 0 means UNKNOWN, and the page reads it that way: with a
                // denominator it prints "heard/len", without one it counts the
                // tracks it actually has. This used to send `heard`, which made
                // every record on the shelf report itself complete -- "9/9
                // tracks heard" on a pressing missing half its side. SMTC never
                // supplies AlbumTrackCount (always 0, verified), so a length
                // can only come from reference data. 0 still means UNKNOWN and
                // the page counts what it has; it is no longer the only answer.
                lens.get(&crate::art::key(&r.artist, &r.album)).copied().unwrap_or(0),
                // A URL, not an inlined data: URI. The web build baked covers
                // into the page because it shipped as a single file; the app has
                // a server, so sleeves stay on disk and the page fetches them --
                // which keeps the HTML small and lets a cover captured later
                // appear without rebuilding anything.
                match crate::art::find(root, &crate::art::key(&r.artist, &r.album)) {
                    Some(p) => format!(
                        r#""/art/{}""#,
                        p.file_name().and_then(|n| n.to_str()).unwrap_or("")
                    ),
                    None => "null".to_string(),
                },
                tracks.join(",")
            )
        })
        .collect();
    format!(r#"{{"user":"local","built":"{}","shelf":[{}]}}"#, crate::now_iso(), items.join(","))
}

/// Percent-decoding, enough for a log line. Not a general URL parser.
fn url_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'%' if i + 2 < b.len() => {
                match u8::from_str_radix(&s[i + 1..i + 3], 16) {
                    Ok(v) => { out.push(v); i += 3; }
                    Err(_) => { out.push(b'%'); i += 1; }
                }
            }
            b'+' => { out.push(b' '); i += 1; }
            c => { out.push(c); i += 1; }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("svg") => "image/svg+xml",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        _ => "application/octet-stream",
    }
}

fn respond(stream: &mut TcpStream, status: &str, ctype: &str, body: &[u8]) {
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

/// Serve `index.html` with the app's data injected and the public flag flipped.
fn index_page(state: &State) -> Vec<u8> {
    let path = state.root.join("index.html");
    let Ok(html) = std::fs::read_to_string(&path) else {
        return b"<h1>index.html not found</h1>".to_vec();
    };

    let shelf = state.shelf.lock().unwrap();
    let injection = format!(
        "<script>window.DEADWAX = {};</script>\n",
        shelf_json(&state.root, &shelf, &state.lens.lock().unwrap())
    );
    drop(shelf);

    // The page reads window.DEADWAX during boot, so the data has to be in place
    // before its main script runs. This anchor is the comment that explains why
    // the public build omits it -- the exact spot the data belongs.
    let anchor = "<!-- PUBLIC BUILD:";
    let html = match html.find(anchor) {
        Some(i) => format!("{}{}{}", &html[..i], injection, &html[i..]),
        // No anchor: fall back to just before </head> rather than failing.
        None => match html.find("</head>") {
            Some(i) => format!("{}{}{}", &html[..i], injection, &html[i..]),
            None => format!("{injection}{html}"),
        },
    };

    html.replace("const PUBLIC = true;", "const PUBLIC = false;").into_bytes()
}

fn now_json(state: &State) -> Vec<u8> {
    let live = state.live.lock().unwrap();
    // The cover travels with the live track, not just with the shelf.
    //
    // The shelf is injected once, when the page loads, so a cover captured
    // while the app is already running could not reach it -- and an UNPRESSED
    // track has no shelf entry to carry one at all. Since most of what gets
    // played has no pressing yet, that meant the record actually on the platter
    // was the one record guaranteed to be blank.
    let art = if live.artist.is_empty() || live.album.is_empty() {
        "null".to_string()
    } else {
        match crate::art::find(&state.root, &crate::art::key(&live.artist, &live.album)) {
            Some(p) => format!(
                r#""/art/{}""#,
                p.file_name().and_then(|n| n.to_str()).unwrap_or("")
            ),
            None => "null".to_string(),
        }
    };
    // The album this track belongs to, as far as the log knows -- every track of
    // it heard so far, with its play counts, even well below the pressing floor.
    // Without this the deck could only put the ONE playing track on a blank
    // disc, so listening to an album straight through read as a run of unrelated
    // one-track records instead of a single record gaining grooves.
    let pending = {
        let all = state.pending.lock().unwrap();
        let want = crate::art::key(&live.artist, &live.album);
        match all
            .iter()
            .find(|r| !want.is_empty() && crate::art::key(&r.artist, &r.album) == want)
        {
            Some(r) => {
                let tracks: Vec<String> = r
                    .tracks
                    .iter()
                    .map(|t| {
                        format!(
                            r#"{{"t":"{}","sec":{:.0},"plays":{},"loud":{:.4}}}"#,
                            json_escape(&t.title),
                            t.secs,
                            t.plays,
                            placeholder_loudness(&t.title)
                        )
                    })
                    .collect();
                format!(
                    r#"{{"album":"{}","heard":{},"floor":{},"plays":{},"tracks":[{}]}}"#,
                    json_escape(&r.album),
                    r.heard,
                    crate::press::TEST_PRESSING_FLOOR,
                    r.plays,
                    tracks.join(",")
                )
            }
            None => "null".to_string(),
        }
    };

    // A cheap stamp of the shelf's contents. The page holds the shelf it was
    // given when it loaded, so a record that crossed the five-track floor while
    // the app was running never appeared in the crate until a restart. When this
    // changes the page refetches. Count plus total plays moves on both a new
    // record and a new play of an existing one.
    let stamp = {
        let sh = state.shelf.lock().unwrap();
        format!("{}:{}", sh.len(), sh.iter().map(|r| r.plays as u64).sum::<u64>())
    };

    format!(
        r#"{{"playing":{},"artist":"{}","track":"{}","album":"{}","position":{:.3},"duration":{:.3},"sampledMs":{},"art":{},"pending":{},"shelfStamp":"{}"}}"#,
        live.playing,
        json_escape(&live.artist),
        json_escape(&live.track),
        json_escape(&live.album),
        live.position,
        live.duration,
        live.sampled_ms,
        art,
        pending,
        stamp
    )
    .into_bytes()
}

fn handle(mut stream: TcpStream, state: &State) {
    let mut reader = BufReader::new(match stream.try_clone() {
        Ok(s) => s,
        Err(_) => return,
    });
    let mut line = String::new();
    if reader.read_line(&mut line).is_err() {
        return;
    }
    let full = line.split_whitespace().nth(1).unwrap_or("/").to_string();
    let path = full.split('?').next().unwrap_or("/");

    // The webview has no console anywhere we can read it: the window is
    // `windows_subsystem = "windows"` and devtools is a human sitting in front
    // of the machine. A page-side exception therefore vanished silently -- and
    // the now-playing poller SWALLOWS exceptions and disables itself after five,
    // so a single throw looked identical to "the feature does not work". This
    // gives errors somewhere to go.
    if path == "/api/log" {
        let msg = full
            .split_once("?m=")
            .map(|(_, q)| url_decode(q.split('&').next().unwrap_or("")))
            .unwrap_or_default();
        let line = format!("{}  {}
", crate::now_iso(), msg);
        let _ = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(state.root.join("src-tauri/webview.log"))
            .map(|mut f| f.write_all(line.as_bytes()));
        respond(&mut stream, "204 No Content", "text/plain", b"");
        return;
    }

    match path {
        "/" | "/index.html" => {
            let body = index_page(state);
            respond(&mut stream, "200 OK", "text/html; charset=utf-8", &body);
        }
        // Push, not poll. The page used to ask every few seconds, which put a
        // whole interval between pausing the music and the deck noticing. This
        // holds the connection open and writes only when the state actually
        // changes, so a pause reaches the record in about as long as it takes
        // SMTC to report it.
        "/api/stream" => {
            let head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-store\r\nConnection: keep-alive\r\n\r\n";
            if stream.write_all(head.as_bytes()).is_err() {
                return;
            }
            // Push on MATERIAL change at once -- track, or play/pause -- and
            // otherwise at most once a second. Position alone changes on every
            // sample, so pushing every change meant ~10 messages a second, each
            // re-anchoring the page's clock. SMTC refreshes position at its own
            // irregular pace, so some samples are stale and carry a position
            // EARLIER than the one before -- which made the readout jump
            // backwards several times a second.
            let mut last_key = String::new();
            let mut last_push =
                std::time::Instant::now() - std::time::Duration::from_secs(9);
            loop {
                let key = {
                    let l = state.live.lock().unwrap();
                    format!("{}|{}|{}|{}", l.playing, l.artist, l.track, l.album)
                };
                if key != last_key
                    || last_push.elapsed() >= std::time::Duration::from_millis(1000)
                {
                    last_key = key;
                    last_push = std::time::Instant::now();
                    let body = now_json(state);
                    let mut msg = Vec::with_capacity(body.len() + 8);
                    msg.extend_from_slice(b"data: ");
                    msg.extend_from_slice(&body);
                    msg.extend_from_slice(b"

");
                    // A dead client shows up as a write error. That is the only
                    // signal we get that the webview reloaded, so it must end
                    // the thread rather than spin forever.
                    if stream.write_all(&msg).is_err() || stream.flush().is_err() {
                        return;
                    }
                }
                std::thread::sleep(std::time::Duration::from_millis(80));
            }
        }
        // Covers, served off disk. Only a bare filename is accepted -- this
        // process can read the whole user profile, and a loopback bind is not an
        // access control.
        p if p.starts_with("/art/") => {
            let name = &p["/art/".len()..];
            let ok = !name.is_empty()
                && name.len() <= 128
                && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')
                && !name.contains("..");
            let file = crate::art::dir(&state.root).join(name);
            match (ok, std::fs::read(&file)) {
                (true, Ok(bytes)) => respond(&mut stream, "200 OK", content_type(&file), &bytes),
                _ => respond(&mut stream, "404 Not Found", "text/plain", b"not found"),
            }
        }
        // The shelf on its own, so the page can pick up records pressed while it
        // has been open rather than only the ones that existed at load.
        "/api/shelf" => {
            let sh = state.shelf.lock().unwrap();
            let body =
                shelf_json(&state.root, &sh, &state.lens.lock().unwrap()).into_bytes();
            drop(sh);
            respond(&mut stream, "200 OK", "application/json; charset=utf-8", &body);
        }
        "/api/now" => {
            let body = now_json(state);
            respond(&mut stream, "200 OK", "application/json; charset=utf-8", &body);
        }
        p => {
            // Static assets. Traversal is refused outright rather than
            // normalised -- this process can read the whole user profile, and a
            // loopback bind is not an access control.
            let rel = p.trim_start_matches('/');
            if rel.is_empty() || rel.contains("..") || rel.contains(':') || rel.starts_with('/') {
                respond(&mut stream, "403 Forbidden", "text/plain", b"no");
                return;
            }
            let file = state.root.join(rel);
            match std::fs::read(&file) {
                Ok(bytes) if file.starts_with(&state.root) => {
                    respond(&mut stream, "200 OK", content_type(&file), &bytes)
                }
                _ => respond(&mut stream, "404 Not Found", "text/plain", b"not found"),
            }
        }
    }
}

/// Bind and serve until the process ends. Returns the bound port.
pub fn spawn(state: Arc<State>, preferred: u16) -> std::io::Result<u16> {
    // Loopback only. Never 0.0.0.0 -- nothing here should be reachable from the
    // network, and the page it serves carries a real person's listening.
    let listener = TcpListener::bind(("127.0.0.1", preferred))
        .or_else(|_| TcpListener::bind(("127.0.0.1", 0)))?;
    let port = listener.local_addr()?.port();

    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let state = Arc::clone(&state);
            std::thread::spawn(move || handle(stream, &state));
        }
    });
    Ok(port)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::press::Tier;

    fn rec() -> Record {
        Record {
            artist: "PARTYNEXTDOOR".into(),
            album: r#"P3 "quoted""#.into(),
            plays: 19,
            heard: 9,
            len: 0,
            tier: Tier::TestPressing,
            tracks: vec![
                crate::press::Track { title: "Not Nice".into(), plays: 4, secs: 187.0 },
                crate::press::Track { title: "Come and See Me".into(), plays: 3, secs: 212.0 },
            ],
        }
    }

    #[test]
    fn shelf_json_is_valid_and_escapes_quotes() {
        let j = shelf_json(Path::new("."), &[rec()], &Default::default());
        assert!(j.contains(r#"\"quoted\""#), "quotes must be escaped, not emitted raw");
        assert!(j.contains(r#""plays":19"#));
        // Parses as JSON.
        let v: serde_json::Value = serde_json::from_str(&j).expect("must be valid JSON");
        assert_eq!(v["shelf"][0]["heard"], 9);
        assert_eq!(v["shelf"][0]["tracks"][0]["t"], "Not Nice");
    }

    #[test]
    fn placeholder_loudness_is_stable_and_in_range() {
        let a = placeholder_loudness("Not Nice");
        assert_eq!(a, placeholder_loudness("Not Nice"), "must be deterministic");
        assert_ne!(a, placeholder_loudness("Come and See Me"));
        for t in ["a", "Not Nice", "", "长号"] {
            let v = placeholder_loudness(t);
            assert!((0.25..=0.80).contains(&v), "{t} gave {v}");
        }
    }
}
