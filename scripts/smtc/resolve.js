'use strict';

/**
 * Turn a raw Windows media session into something a record can be pressed from.
 *
 * Two jobs, in order:
 *
 *   1. isMusic()     -- is this even music? Chrome publishes ANY page with audio
 *                       to the media session. A Minecraft server page appeared
 *                       beside Spotify during the 2026-08-17 capture. Left alone
 *                       the app would press a record for a web page.
 *
 *   2. unpackTitle() -- browser tabs cram everything into `title` and leave
 *                       `albumTitle` empty:
 *                         "PARTYNEXTDOOR - MAKE IT TO THE MORNING (Official Visualizer)"
 *                       That has to become artist + track before the bundled
 *                       index can find the album.
 *
 * WHY THIS IS NOT TAIL WORK
 * -------------------------
 * Measured 2026-08-17: Spotify reports cleanly, browsers report junk. Rishi's own
 * sources are Spotify, YouTube and SoundCloud -- so roughly half his listening
 * arrives in the junk tier, and YouTube Music is the fastest-growing platform
 * globally. This layer carries real load, not edge cases.
 *
 * STANDING BIAS: prefer returning nothing over returning something wrong.
 * A track we fail to parse is a missed play. A track we parse WRONG presses a
 * record that should not exist, or adds wear to the wrong disc. The first is
 * invisible; the second is a defect the user can see on their shelf.
 */

// ===========================================================================
// 1. IS THIS MUSIC?
// ===========================================================================

// Sources that only ever publish real music. Trusted without further checks --
// their metadata comes from a catalogue, not a page title.
const MUSIC_APPS = [
  'spotify',
  'zunemusic',        // Windows Media Player (modern)
  'apple',            // Apple Music / iTunes
  'tidal',
  'amazon',
  'foobar2000',
  'musicbee',
  'aimp',
  'winamp',
  'vlc',
  'deezer',
  'youtubemusic',     // the desktop wrapper, not the browser tab
];

// Browsers publish everything. They are neither trusted nor rejected outright --
// they get the content checks below.
const BROWSERS = ['chrome', 'msedge', 'edge', 'firefox', 'brave', 'opera', 'vivaldi', 'zen'];

const lower = (s) => String(s || '').toLowerCase();

// Shapes that appear in web page titles and never in a track name.
const NOT_MUSIC_TITLE = [
  /\|\s*[a-z0-9-]+\.(com|net|org|io|gg|tv)\b/i,   // "Something | example.com"
  /\bserver\b.*\bminecraft\b/i,
  /\bminecraft\b.*\bserver\b/i,
  /\b(dashboard|console|admin panel|settings|login|sign in)\b/i,
  /\b(google (docs|sheets|drive|meet)|notion|figma|jira|gmail|outlook)\b/i,
  /\b(stack overflow|github|reddit|twitter|facebook)\b/i,
  /\bep(isode)?\.?\s*\d+\b.*\bpodcast\b/i,
  /\bpodcast\b/i,
  /\b(tutorial|how to|full course|lecture|documentary)\b/i,
  /\b(stream|streaming) (now|live)\b/i,
];

/**
 * Decide whether a session should be allowed to press a record.
 *
 * @param {object} s  { sourceApp, title, artist, albumTitle, playbackType, durationSec }
 * @returns {{ music: boolean, reason: string }}
 */
function isMusic(s) {
  const app = lower(s.sourceApp);
  const title = String(s.title || '').trim();
  const artist = String(s.artist || '').trim();

  if (!title) return { music: false, reason: 'no title' };

  // A dedicated music application is trusted outright.
  if (MUSIC_APPS.some((m) => app.includes(m))) {
    return { music: true, reason: 'known music app' };
  }

  const isBrowser = BROWSERS.some((b) => app.includes(b));

  // An unknown source with a proper album is almost certainly a music player we
  // have not listed. Accept it -- the alternative is silently ignoring players.
  if (!isBrowser && s.albumTitle) {
    return { music: true, reason: 'unlisted app, but supplies an album' };
  }

  // From here on: a browser tab, or an unknown app with no album.

  // playbackType is a weak signal on its own -- a YouTube music video reports
  // as Music, but so does anything else a page chooses to declare. It is only
  // useful in the negative direction.
  if (s.playbackType && lower(s.playbackType) === 'video') {
    return { music: false, reason: 'declared as video' };
  }

  for (const re of NOT_MUSIC_TITLE) {
    if (re.test(title)) return { music: false, reason: 'page-title shape' };
  }

  // No artist and no separator in the title means there is nothing to press
  // FROM, even if it happens to be music.
  if (!artist && !/\s[-–—]\s/.test(title)) {
    return { music: false, reason: 'no artist and no parseable title' };
  }

  // Very short media is a UI sound, a preview or a page, not a track.
  if (s.durationSec && s.durationSec < 45) {
    return { music: false, reason: 'too short to be a track' };
  }

  return { music: true, reason: 'browser tab, passes checks' };
}

// ===========================================================================
// 2. UNPACK A BROWSER TITLE
// ===========================================================================

// Bracketed suffixes that are upload furniture, never part of a track name.
const UPLOAD_JUNK = [
  /official\s+(music\s+)?video/i,
  /official\s+(audio|lyric|visuali[sz]er|version)/i,
  /^\s*(audio|video|visuali[sz]er|lyrics?|lyric video)\s*$/i,
  /^\s*(hd|hq|4k|8k|1080p|720p|full hd)\s*$/i,
  /^\s*(m\/?v|mv)\s*$/i,
  /free\s+download/i,
  /out\s+now/i,
  /prod\.?\s+by/i,
  /^\s*explicit\s*$/i,
  /^\s*clean\s*$/i,
  /\bncs\s+release\b/i,
  /copyright\s+free/i,
  /^\s*\d{4}\s*$/,          // a bare year in brackets
];

// Channel/uploader suffixes after a pipe. "Track | Artist" and
// "Track | SomeChannel" are indistinguishable, so the pipe tail is dropped
// rather than guessed at.
const stripPipeTail = (s) => s.split('|')[0].trim();

const isJunkChunk = (text) => UPLOAD_JUNK.some((re) => re.test(text.trim()));

// Shapes that appear in a CHANNEL name and never in an artist credit. Used only
// as a last-resort veto -- see step 3 of unpackTitle. Kept deliberately narrow:
// a real artist name must never match, so nothing here is a plain English word
// that could plausibly be part of one.
const UPLOADER_SHAPE = [
  /https?:\/\//i,
  /\bwww\.[a-z0-9-]+\.[a-z]{2,}/i,
  /[a-z0-9-]+\.(com|net|org|io|ml|tk|co)\b/i,
  /[®™]/,
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u,   // emoji and pictographs
  /\b(uploads?|archive|vault|leaks?|unreleased|topic)\b/i,
  /\bhidden gems\b/i,
];

const looksLikeUploader = (name) => UPLOADER_SHAPE.some((re) => re.test(name));

/**
 * Remove bracketed upload furniture, keeping anything unrecognised.
 *
 * Scans EVERY bracketed chunk rather than stopping at the first unknown one.
 * Stopping was the first implementation and it was wrong: junk routinely sits
 * after a meaningful bracket --
 *   "Drake - Work (feat. Rihanna) (Official Audio)"
 * -- so halting at "(feat. Rihanna)" left "(Official Audio)" glued to the track
 * name. Continuing the scan is safe here because only chunks on the explicit
 * junk list are ever removed; unknown chunks are left exactly where they are.
 */
function stripJunkBrackets(title) {
  return title
    .replace(/\s*[\(\[]([^()\[\]]*)[\)\]]/g, (whole, inner) => (isJunkChunk(inner) ? ' ' : whole))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Recover artist and track from a browser session.
 *
 * @param {object} s { title, artist, albumTitle }
 * @returns {{ artist: string, track: string, confidence: 'high'|'medium'|'low' }|null}
 */
function unpackTitle(s) {
  let title = String(s.title || '').trim();
  const artistField = String(s.artist || '').trim();
  if (!title) return null;

  title = stripPipeTail(title);
  title = stripJunkBrackets(title);
  title = title.replace(/\s+/g, ' ').trim();
  if (!title) return null;

  // STEP 1 -- the artist field is repeated as a prefix of the title. This is the
  // shape YouTube produced in the real capture, and the one case where the
  // artist field is confirmed by a second source:
  //   artist: "PARTYNEXTDOOR"
  //   title : "PARTYNEXTDOOR - MAKE IT TO THE MORNING (Official Visualizer)"
  if (artistField) {
    const esc = artistField.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const prefix = new RegExp('^\\s*' + esc + '\\s*[-–—:]\\s*', 'i');
    if (prefix.test(title)) {
      const track = title.replace(prefix, '').trim();
      if (track) return { artist: artistField, track, confidence: 'high' };
    }
  }

  // STEP 2 -- the title splits on a dash, so the title carries the credit and
  // the artist field does not. TRUST THE TITLE AND DISCARD THE FIELD.
  //
  // This inversion is the point of the whole function. On SoundCloud and on
  // unofficial YouTube uploads the artist field is the UPLOADER, and taking it
  // at face value -- which this code did until 2026-08-19 -- files real records
  // under channel names. Captured that day, verbatim:
  //
  //   artist "hidden gems"                  title "PARTYNEXTDOOR- Something New"
  //   artist "bc"                           title "PARTYNEXTDOOR - Meghan Interlude"
  //   artist "Prince Elliot [emoji]"        title "PARTYNEXTDOOR- WANT ME (UNRELEASED)"
  //   artist "The New Industry(R) (www...)" title "PARTYNEXTDOOR - 647 (Company)"
  //
  // Four listens, four different "artists", one actual artist. The title had it
  // right every time.
  //
  // Whitespace is required AFTER the dash but optional before it, because
  // "PARTYNEXTDOOR- Something New" is a real captured shape. Requiring it after
  // is what still keeps "Jay-Z" and "Wu-Tang" intact -- neither has a space
  // following the hyphen, so neither can match.
  const split = title.match(/^(.+?)\s*[-–—]\s+(.+)$/);
  if (split) {
    const artist = split[1].trim();
    const track = split[2].trim();
    // A split that produces an empty or absurd side is not a split.
    if (artist && track && artist.length < 90 && track.length < 120) {
      // KNOWN LIMIT, deliberately not guessed at: some uploads are reversed --
      // "Whatever You Say - PartyNextDoor", real capture, same day. Nothing in
      // the string says which side is which, so conventional ARTIST - TRACK
      // order is assumed and confidence stays medium. The bundled index is the
      // right place to arbitrate: it can try both orders and keep whichever
      // matches a real release. Guessing here would only hide the problem.
      return { artist, track, confidence: 'medium' };
    }
  }

  // STEP 3 -- no split. The artist field is the only candidate left, and it is
  // unconfirmed by anything else.
  if (artistField) {
    // An unconfirmed field that reads like a channel is worse than nothing -- it
    // presses a record credited to the uploader. Refuse instead.
    if (looksLikeUploader(artistField)) return null;
    return { artist: artistField, track: title, confidence: 'low' };
  }

  // Nothing reliable. Returning null is correct -- see the standing bias above.
  return null;
}

// ===========================================================================

/** Full pipeline: raw session -> pressable {artist, track} or a stated refusal. */
function resolve(session) {
  const verdict = isMusic(session);
  if (!verdict.music) return { ok: false, reason: verdict.reason };

  // A trusted source with a real album needs no unpacking at all.
  if (session.albumTitle && session.artist) {
    return {
      ok: true,
      artist: session.artist,
      track: session.title,
      album: session.albumTitle,
      confidence: 'high',
      reason: 'source supplied album',
    };
  }

  const parsed = unpackTitle(session);
  if (!parsed) return { ok: false, reason: 'could not parse artist and track' };

  return {
    ok: true,
    artist: parsed.artist,
    track: parsed.track,
    album: null, // the bundled index resolves this
    confidence: parsed.confidence,
    reason: 'unpacked from title',
  };
}

module.exports = { isMusic, unpackTitle, resolve, stripJunkBrackets };
