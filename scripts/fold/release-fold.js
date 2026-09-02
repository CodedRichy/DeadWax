'use strict';

/**
 * Release folding: collapse deluxe / expanded / remastered / bonus-track editions
 * into the one record they actually are, and refuse to collapse the ones that are
 * genuinely different releases.
 *
 * WHY THIS IS NOT A FEATURE
 * -------------------------
 * DeadWax presses one record per album. If the deluxe edition presses as a second
 * record, the shelf is visibly wrong and the object stops being credible -- this
 * is the 566-upvote r/lastfm complaint, and it is a correctness prerequisite, not
 * a roadmap item.
 *
 * It also carries a second job discovered on 2026-08-17 while dumping SMTC:
 * Windows' media session reports trackNumber but ALWAYS reports albumTrackCount
 * as 0. SMTC does not supply the denominator the >=50% coverage rule needs. So
 * whatever index ships to fold editions must also carry the canonical tracklist
 * length. One index, two jobs.
 *
 * METHOD
 * ------
 * The coverage rule was not argued into place, it was measured -- the original
 * front-to-back rule matched zero albums against 20,961 real scrobbles. Same
 * discipline here: run the normalizer over the real history and hand-check every
 * merge before trusting it.
 *
 * THE STANDING BIAS: a false merge is worse than a missed merge.
 * A missed merge shows two records where there should be one -- untidy. A false
 * merge silently destroys a distinct record and its wear. So anything the
 * normalizer does not recognise is KEPT, never stripped.
 *
 * USAGE
 *   node scripts/fold/release-fold.js --pull     # fetch history once, cache it
 *   node scripts/fold/release-fold.js            # fold the cache, report
 *   node scripts/fold/release-fold.js --all      # include single-member groups
 *
 * --pull talks to Last.fm. That is research on your own account (non-commercial
 * use, permitted), NOT something the shipped app ever does. Cached output is
 * gitignored: it is your listening history.
 */

const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, 'cache');
const CACHE = path.join(CACHE_DIR, 'history.json');

// ===========================================================================
// NORMALIZER
// ===========================================================================

// Bracketed content containing any of these marks a genuinely DIFFERENT release
// group. MusicBrainz treats these as separate, and so must we. Checked before
// anything is stripped -- a live album is not the studio album with a suffix.
const NEVER_FOLD = [
  'live', 'acoustic', 'unplugged', 'instrumental', 'a cappella', 'acapella',
  'demo', 'demos', 'remix', 'remixes', 'remixed', 'karaoke', 'tribute',
  'covers', 'commentary', 'session', 'sessions',
  'sped up', 'slowed', 'reverb', 'chopped', 'screwed', 'radio 1',
  'orchestral', 'symphonic', 'mtv',
];

// NOT on that list, deliberately: 'soundtrack' and 'score'.
//
// Audited against real history 2026-08-17 and it was 163 of 200 blocks -- this
// library is heavy with Malayalam and Tamil film music, where the OST is not a
// variant of some studio album, it IS the album. Blocking them caused a real
// missed merge on exactly the case this code exists for:
//
//   Interstellar (Original Motion Picture Soundtrack)
//   Interstellar (Original Motion Picture Soundtrack) [Expanded Edition]
//
// No blocking token is needed to keep them apart from anything, because
// "soundtrack" is not an edition marker, so the unknown-chunks-are-kept rule
// already preserves it in the key. Blocking on top of that only prevented the
// edition suffix outside it from being peeled.

// Bracketed or suffixed content containing ONLY these is an edition marker on
// the same release group, and is safe to strip.
const EDITION = [
  'deluxe', 'super deluxe', 'expanded', 'extended', 'remaster', 'remastered',
  'anniversary', 'special', 'collector', 'collectors', "collector's", 'limited',
  'bonus', 'bonus track', 'bonus tracks', 'explicit', 'clean', 'standard',
  'international', 'japanese', 'japan', 'uk', 'us', 'edition', 'version',
  'reissue', 'digital', 'mono', 'stereo', 'exclusive', 'target', 'spotify',
  'apple', 'amazon', 'itunes', 'tour', 'complete', 'original',
];

const DASHES = /[‐-―−]/g;   // hyphen variants -> '-'
const QUOTES = /[‘’‛]/g;    // curly single -> '

const stripDiacritics = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '');

const basic = (s) =>
  stripDiacritics(String(s || ''))
    .replace(DASHES, '-')
    .replace(QUOTES, "'")
    .toLowerCase()
    .trim();

// Does this chunk of text consist only of edition markers, year numbers and
// filler? Anything unrecognised makes it UNKNOWN, and unknown is kept.
function isEditionOnly(text) {
  const words = text
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return false;

  let i = 0;
  while (i < words.length) {
    // Try the longest multi-word edition phrase first.
    let matched = 0;
    for (let take = 3; take >= 1; take--) {
      const phrase = words.slice(i, i + take).join(' ');
      if (EDITION.includes(phrase)) { matched = take; break; }
    }
    if (matched) { i += matched; continue; }

    const w = words[i];
    // A bare year (1994, 2011) or an ordinal like "20th" is edition filler.
    if (/^\d{4}$/.test(w) || /^\d{1,3}(st|nd|rd|th)$/.test(w)) { i++; continue; }
    if (w === 'the' || w === 'a' || w === 'and' || w === 'of') { i++; continue; }

    return false; // unrecognised word -> not an edition marker -> keep it
  }
  return true;
}

const hasNeverFold = (text) =>
  NEVER_FOLD.some((t) => new RegExp(`\\b${t}\\b`).test(text));

/**
 * Fold an album title to its release-group key.
 * Returns { key, dropped[], blocked }  -- blocked means a never-fold token was
 * seen, so this title deliberately keeps its own identity.
 */
function foldTitle(raw) {
  let s = basic(raw);
  const dropped = [];
  let blocked = false;

  // Peel trailing bracketed chunks, right to left.
  for (;;) {
    const m = s.match(/\s*[\(\[]([^()\[\]]*)[\)\]]\s*$/);
    if (!m) break;
    const inner = m[1].trim();

    if (hasNeverFold(inner)) { blocked = true; break; }  // stop; keep the rest
    if (!isEditionOnly(inner)) break;                    // unknown -> keep

    dropped.push(inner);
    s = s.slice(0, m.index).trim();
  }

  // Peel a trailing " - deluxe edition" / ": remastered 2011" style suffix.
  for (;;) {
    const m = s.match(/\s*[-:]\s*([^-:]+)$/);
    if (!m) break;
    const tail = m[1].trim();
    if (hasNeverFold(tail)) { blocked = true; break; }
    if (!isEditionOnly(tail)) break;
    dropped.push(tail);
    s = s.slice(0, m.index).trim();
  }

  // Disc / CD markers sit on the same release group.
  s = s.replace(/\s*[\(\[]?\b(disc|cd)\s*\d+\b[\)\]]?\s*$/g, '').trim();

  // NOTE: leading articles are deliberately NOT stripped. "The Wall" and "Wall"
  // are not obviously the same record, and article-stripping is a classic source
  // of false merges. Missed merge beats false merge.

  let key = s.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

  // Symbol-only titles. Ed Sheeran's discography is literally +, x, ÷, =, -.
  // Stripping non-alphanumerics leaves an empty key, and every symbol-titled
  // album in the library then folds into one record. Caught against real
  // history on 2026-08-17: "÷ (Deluxe)" merged with "=". When the alphanumeric
  // key is empty, the punctuation IS the title -- keep it.
  if (!key) key = s.replace(/\s+/g, ' ').trim();

  return { key, dropped, blocked };
}

// "Artist feat. X" and "Artist & Y" fragment the same artist across entries.
function foldArtist(raw) {
  let s = basic(raw)
    .replace(/\s*\b(feat|ft|featuring|with)\b\.?\s+.*$/, '')
    .replace(/\s*&\s*/g, ' and ');
  return s.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// ===========================================================================
// PULL  (--pull)
// ===========================================================================

function readEnv() {
  const p = path.resolve(__dirname, '..', '..', '.env');
  const env = {};
  for (const line of fs.readFileSync(p, 'utf-8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pull(candidateLimit) {
  const env = readEnv();
  if (!env.LASTFM_API_KEY || !env.LASTFM_USER) {
    throw new Error('.env needs LASTFM_API_KEY and LASTFM_USER');
  }

  const call = async (params) => {
    const qs = new URLSearchParams({ ...params, api_key: env.LASTFM_API_KEY, format: 'json' });
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(`https://ws.audioscrobbler.com/2.0/?${qs}`);
      if (res.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
      const json = await res.json();
      if (json.error) throw new Error(`last.fm ${json.error}: ${json.message}`);
      return json;
    }
    throw new Error('rate limited');
  };

  const pullAll = async (method, item) => {
    const out = [];
    let page = 1, totalPages = 1;
    do {
      const j = await call({ method, user: env.LASTFM_USER, period: 'overall', limit: 1000, page });
      const root = j[Object.keys(j)[0]];
      totalPages = parseInt(root['@attr'].totalPages, 10);
      const rows = root[item];
      out.push(...(Array.isArray(rows) ? rows : rows ? [rows] : []));
      page++;
      await sleep(200);
    } while (page <= totalPages);
    return out;
  };

  process.stderr.write('pulling lifetime albums...\n');
  const albums = await pullAll('user.getTopAlbums', 'album');
  process.stderr.write(`  ${albums.length} albums\n`);

  process.stderr.write('pulling lifetime tracks...\n');
  const tracks = await pullAll('user.getTopTracks', 'track');
  process.stderr.write(`  ${tracks.length} tracks\n`);

  // Tracklists give the canonical denominator SMTC refuses to supply.
  const ranked = albums
    .map((a) => ({ artist: a.artist.name, album: a.name, plays: parseInt(a.playcount, 10) }))
    .sort((x, y) => y.plays - x.plays)
    .slice(0, candidateLimit);

  process.stderr.write(`resolving ${ranked.length} tracklists...\n`);
  const tracklists = {};
  let done = 0;
  for (const a of ranked) {
    try {
      const j = await call({ method: 'album.getInfo', artist: a.artist, album: a.album, autocorrect: 1 });
      const tr = j.album && j.album.tracks && j.album.tracks.track;
      const list = Array.isArray(tr) ? tr : tr ? [tr] : [];
      tracklists[`${a.artist}|||${a.album}`] = list.map((t) => t.name);
    } catch {
      // A missing tracklist is normal for obscure releases; skip it.
    }
    if (++done % 25 === 0) process.stderr.write(`  ${done}/${ranked.length}\n`);
    await sleep(200);
  }

  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(
    CACHE,
    JSON.stringify({
      pulledAt: new Date().toISOString(),
      user: env.LASTFM_USER,
      albums: albums.map((a) => ({ artist: a.artist.name, album: a.name, plays: parseInt(a.playcount, 10) })),
      tracks: tracks.map((t) => ({ artist: t.artist.name, track: t.name, plays: parseInt(t.playcount, 10) })),
      tracklists,
    }),
    'utf-8'
  );
  process.stderr.write(`\ncached -> ${path.relative(process.cwd(), CACHE)}\n`);
}

// ===========================================================================
// FOLD + REPORT
// ===========================================================================

function report(showAll) {
  const data = JSON.parse(fs.readFileSync(CACHE, 'utf-8'));

  const groups = new Map();
  let blockedCount = 0;

  for (const a of data.albums) {
    const t = foldTitle(a.album);
    const key = `${foldArtist(a.artist)}|||${t.key}${t.blocked ? '|||' + basic(a.album) : ''}`;
    if (t.blocked) blockedCount++;

    if (!groups.has(key)) groups.set(key, { artist: a.artist, members: [], plays: 0 });
    const g = groups.get(key);
    g.members.push({ album: a.album, plays: a.plays, dropped: t.dropped, blocked: t.blocked });
    g.plays += a.plays;
  }

  const merged = [...groups.values()].filter((g) => g.members.length > 1);
  merged.sort((a, b) => b.plays - a.plays);

  console.log('');
  console.log('RELEASE FOLD');
  console.log('='.repeat(74));
  console.log(`  cache      : ${data.pulledAt.slice(0, 10)}  (${data.user})`);
  console.log(`  albums in  : ${data.albums.length}`);
  console.log(`  records out: ${groups.size}`);
  console.log(`  collapsed  : ${data.albums.length - groups.size} entries folded into ${merged.length} records`);
  console.log(`  never-fold : ${blockedCount} entries kept separate by a blocking token`);
  console.log('');
  console.log('  Every merge below must be read by hand. A false merge silently');
  console.log('  destroys a record; a missed merge is only untidy.');
  console.log('');

  // Canonical denominator per merged record: the SHORTEST plausible tracklist
  // among its members. Using the union would mean a deluxe listener needs 50% of
  // 25 tracks where a standard listener needs 50% of 12 -- the shelf would
  // silently punish people who own the better edition.
  const lengthOf = (artist, album) => {
    const list = data.tracklists[`${artist}|||${album}`];
    return list ? list.length : 0;
  };

  for (const g of merged) {
    const lengths = g.members
      .map((m) => lengthOf(g.artist, m.album))
      .filter((n) => n >= 5);
    const canonical = lengths.length ? Math.min(...lengths) : null;
    const spread = lengths.length ? Math.max(...lengths) : null;

    console.log('-'.repeat(74));
    console.log(`  ${g.artist} -- ${g.plays} plays across ${g.members.length} entries`);
    if (canonical) {
      const flag = spread && spread > canonical * 1.6 ? '   <-- CHECK: wide track-count spread' : '';
      console.log(`  canonical tracklist: ${canonical}${spread !== canonical ? ` (members range to ${spread})` : ''}${flag}`);
    } else {
      console.log('  canonical tracklist: UNKNOWN -- no tracklist cached');
    }
    for (const m of g.members.sort((x, y) => y.plays - x.plays)) {
      const n = lengthOf(g.artist, m.album);
      const drop = m.dropped.length ? `   [dropped: ${m.dropped.join(' / ')}]` : '';
      console.log(`    ${String(m.plays).padStart(5)}  ${n ? String(n).padStart(2) : ' ?'}tr  ${m.album}${drop}`);
    }
  }

  if (showAll) {
    console.log('');
    console.log('='.repeat(74));
    console.log('SINGLE-MEMBER RECORDS (no fold applied)');
    for (const g of [...groups.values()].filter((x) => x.members.length === 1).sort((a, b) => b.plays - a.plays).slice(0, 60)) {
      console.log(`    ${String(g.plays).padStart(5)}  ${g.artist} - ${g.members[0].album}`);
    }
  }

  console.log('');
  console.log('='.repeat(74));
  console.log(`  ${data.albums.length} entries -> ${groups.size} records`);
  console.log('');
}

// ===========================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--pull')) {
    const limitArg = args.find((a) => a.startsWith('--limit='));
    await pull(limitArg ? parseInt(limitArg.split('=')[1], 10) : 300);
    return;
  }

  if (!fs.existsSync(CACHE)) {
    console.log('No cached history. Run once with --pull:');
    console.log('  node scripts/fold/release-fold.js --pull');
    process.exit(1);
  }

  report(args.includes('--all'));
}

// Only run when invoked directly -- fold-test.js imports the normalizer.
if (require.main === module) {
  main().catch((e) => {
    console.error('FAILED:', e.message);
    process.exit(1);
  });
}

module.exports = { foldTitle, foldArtist };
