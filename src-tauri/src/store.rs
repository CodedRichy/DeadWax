//! The listen log. Append-only, never edited, never overwritten.
//!
//! THE ONE RULE
//! ------------
//! This table is EVIDENCE. Every row is what Windows actually reported, kept
//! verbatim -- including the rows the resolver would reject and the artist names
//! it will later correct. Nothing derived is stored here.
//!
//! The shelf is a pure function of this log (see `press`). That is what lets a
//! better pressing rule, a better resolver, or a real track-count denominator be
//! applied to the ENTIRE history by recomputing, instead of being stuck with
//! whatever today's code believed. `scripts/smtc/clean.js` established the
//! discipline: guesses must never overwrite evidence.
//!
//! It is also why the app can hand the whole thing to a public page later
//! without a second implementation -- the page renders the derived shelf, and
//! this stays private.

use rusqlite::{params, Connection};
use std::path::Path;

pub struct Store {
    conn: Connection,
}

/// One completed listen, exactly as captured, plus how long it actually played.
#[derive(Debug, Clone)]
pub struct Listen {
    pub started_at: String,
    pub ended_at: String,
    pub source_app: String,
    pub title: String,
    pub artist: String,
    pub album_title: String,
    pub album_artist: String,
    pub track_number: i32,
    pub album_track_count: i32,
    pub playback_type: String,
    pub duration_sec: f64,
    pub dwell_sec: f64,
    pub counted: bool,
    pub end_reason: String,
}

impl Store {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        Self::migrate(&conn)?;
        Ok(Self { conn })
    }

    pub fn open_in_memory() -> rusqlite::Result<Self> {
        let conn = Connection::open_in_memory()?;
        Self::migrate(&conn)?;
        Ok(Self { conn })
    }

    fn migrate(conn: &Connection) -> rusqlite::Result<()> {
        // WAL so a crash mid-write cannot take the archive with it. The log is
        // the one artifact that cannot be regenerated from anything else.
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS listens (
                id                INTEGER PRIMARY KEY,
                started_at        TEXT    NOT NULL,
                ended_at          TEXT    NOT NULL,
                source_app        TEXT    NOT NULL,
                title             TEXT    NOT NULL,
                artist            TEXT    NOT NULL,
                album_title       TEXT    NOT NULL,
                album_artist      TEXT    NOT NULL,
                track_number      INTEGER NOT NULL,
                album_track_count INTEGER NOT NULL,
                playback_type     TEXT    NOT NULL,
                duration_sec      REAL    NOT NULL,
                dwell_sec         REAL    NOT NULL,
                counted           INTEGER NOT NULL,
                end_reason        TEXT    NOT NULL
            );

            CREATE INDEX IF NOT EXISTS listens_album ON listens(artist, album_title);
            CREATE INDEX IF NOT EXISTS listens_time  ON listens(started_at);
            -- Supports append_new's existence check. The widget's log is
            -- re-read continuously, so that check runs once per line of it.
            CREATE INDEX IF NOT EXISTS listens_ident ON listens(started_at, title, artist);

            -- The uptime ledger, carried over from the PowerShell collector.
            -- A listen log records what was heard; it cannot record what was
            -- MISSED, and without that the dataset quietly lies -- a stretch
            -- with no plays reads identically whether nothing was playing or the
            -- collector was dead. Starts, stops, pauses and the gaps between
            -- them are written down so blind windows are known, not inferred.
            CREATE TABLE IF NOT EXISTS events (
                id      INTEGER PRIMARY KEY,
                ts      TEXT NOT NULL,
                event   TEXT NOT NULL,
                detail  TEXT NOT NULL DEFAULT ''
            );
            "#,
        )?;
        Ok(())
    }

    pub fn append(&self, l: &Listen) -> rusqlite::Result<i64> {
        self.conn.execute(
            r#"INSERT INTO listens
               (started_at, ended_at, source_app, title, artist, album_title,
                album_artist, track_number, album_track_count, playback_type,
                duration_sec, dwell_sec, counted, end_reason)
               VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)"#,
            params![
                l.started_at, l.ended_at, l.source_app, l.title, l.artist,
                l.album_title, l.album_artist, l.track_number, l.album_track_count,
                l.playback_type, l.duration_sec, l.dwell_sec, l.counted as i32,
                l.end_reason
            ],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Append only if this exact listen is not already in the log.
    ///
    /// The collector's JSONL is re-read from the top every few seconds, so
    /// almost every line offered here is already stored. Identity is
    /// `started_at + title + artist`: the collector writes each line once and
    /// never rewrites it, so those three are stable for the life of a row.
    ///
    /// This does NOT reconcile two collectors watching the same SMTC session --
    /// their timestamps differ by however far apart their polls landed, and no
    /// key can merge those after the fact. That is prevented structurally
    /// instead, by only ever having one collector running (see `runtime`).
    ///
    /// Returns true if the row was new.
    pub fn append_new(&self, l: &Listen) -> rusqlite::Result<bool> {
        let n = self.conn.execute(
            r#"INSERT INTO listens
               (started_at, ended_at, source_app, title, artist, album_title,
                album_artist, track_number, album_track_count, playback_type,
                duration_sec, dwell_sec, counted, end_reason)
               SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14
               WHERE NOT EXISTS (
                   SELECT 1 FROM listens
                   WHERE started_at = ?1 AND title = ?4 AND artist = ?5
               )"#,
            params![
                l.started_at, l.ended_at, l.source_app, l.title, l.artist,
                l.album_title, l.album_artist, l.track_number, l.album_track_count,
                l.playback_type, l.duration_sec, l.dwell_sec, l.counted as i32,
                l.end_reason
            ],
        )?;
        Ok(n > 0)
    }

    pub fn event(&self, event: &str, detail: &str) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO events (ts, event, detail) VALUES (?1, ?2, ?3)",
            params![crate::now_iso(), event, detail],
        )?;
        Ok(())
    }

    /// Every counted listen, oldest first. The input to pressing.
    ///
    /// Uncounted rows are excluded here and only here: they stay in the table
    /// forever as evidence, but a four-second skip must never contribute to a
    /// record. That distinction is the entire reason dwell is measured.
    pub fn counted_listens(&self) -> rusqlite::Result<Vec<Listen>> {
        let mut stmt = self.conn.prepare(
            r#"SELECT started_at, ended_at, source_app, title, artist, album_title,
                      album_artist, track_number, album_track_count, playback_type,
                      duration_sec, dwell_sec, counted, end_reason
               FROM listens WHERE counted = 1 ORDER BY started_at ASC"#,
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Listen {
                started_at: r.get(0)?,
                ended_at: r.get(1)?,
                source_app: r.get(2)?,
                title: r.get(3)?,
                artist: r.get(4)?,
                album_title: r.get(5)?,
                album_artist: r.get(6)?,
                track_number: r.get(7)?,
                album_track_count: r.get(8)?,
                playback_type: r.get(9)?,
                duration_sec: r.get(10)?,
                dwell_sec: r.get(11)?,
                counted: r.get::<_, i32>(12)? != 0,
                end_reason: r.get(13)?,
            })
        })?;
        rows.collect()
    }

    pub fn count(&self) -> rusqlite::Result<i64> {
        self.conn.query_row("SELECT COUNT(*) FROM listens", [], |r| r.get(0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn listen(artist: &str, title: &str, counted: bool) -> Listen {
        Listen {
            started_at: "2026-09-01T10:00:00+05:30".into(),
            ended_at: "2026-09-01T10:03:00+05:30".into(),
            source_app: "Spotify.exe".into(),
            title: title.into(),
            artist: artist.into(),
            album_title: "An Album".into(),
            album_artist: artist.into(),
            track_number: 1,
            album_track_count: 0,
            playback_type: "Music".into(),
            duration_sec: 200.0,
            dwell_sec: if counted { 180.0 } else { 4.0 },
            counted,
            end_reason: "track changed".into(),
        }
    }

    #[test]
    fn append_new_is_idempotent() {
        let s = Store::open_in_memory().unwrap();
        let l = listen("Sean Paul", "She Doesn't Mind", true);
        assert!(s.append_new(&l).unwrap(), "first offer must insert");
        assert!(!s.append_new(&l).unwrap(), "second offer must not");
        assert_eq!(s.count().unwrap(), 1);

        // Same track, different start: a genuine replay, not a re-read.
        let mut again = l.clone();
        again.started_at = "2026-09-01T11:00:00+05:30".into();
        assert!(s.append_new(&again).unwrap(), "a replay is a new listen");
        assert_eq!(s.count().unwrap(), 2);
    }

    #[test]
    fn appends_and_reads_back() {
        let s = Store::open_in_memory().unwrap();
        s.append(&listen("PARTYNEXTDOOR", "Bout It", true)).unwrap();
        s.append(&listen("PARTYNEXTDOOR", "Not Nice", false)).unwrap();
        assert_eq!(s.count().unwrap(), 2);

        // Both rows survive as evidence; only the counted one feeds pressing.
        let counted = s.counted_listens().unwrap();
        assert_eq!(counted.len(), 1);
        assert_eq!(counted[0].title, "Bout It");
    }

    #[test]
    fn events_are_recorded() {
        let s = Store::open_in_memory().unwrap();
        s.event("start", "").unwrap();
        s.event("gap", "37.5s: collector died, or the machine was off").unwrap();
        let n: i64 = s.conn.query_row("SELECT COUNT(*) FROM events", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 2);
    }
}
