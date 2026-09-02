'use strict';

/**
 * The shelf, rebuilt on top of release folding -- and the cold-start question
 * answered with numbers instead of intuition.
 *
 * Supersedes scripts/shelf.js, which used a cruder inline normalizer and had no
 * concept of a partially-heard record.
 *
 * THE QUESTION THIS EXISTS TO ANSWER
 * ----------------------------------
 * A new user's crate is empty on day one. docs/BUSINESS.md 7.3 proposes TEST
 * PRESSINGS as the fix: a record presses on first contact as a white-label test
 * pressing, and is promoted to a full pressing once >=50% of its distinct tracks
 * have been heard. The claim is that this fills the crate from hour one without
 * lying about anything.
 *
 * Nobody has checked what that actually produces. This does.
 *
 * Three tiers:
 *   PRESSED  >= COVERAGE_FULL of distinct tracks heard  -- a real record
 *   TEST     at least one track heard, below that       -- white label
 *   unheard  nothing heard                              -- not in the crate
 *
 * Wear spread (min..max play count across the tracks actually heard) is reported
 * because it is the thing that makes the object worth rendering at all -- the
 * vault measured 12x-154x within a single album on shuffle listening.
 *
 * Usage:
 *   node scripts/fold/shelf-v2.js
 *   node scripts/fold/shelf-v2.js --full=0.5 --list
 */

const fs = require('fs');
const path = require('path');
const { foldTitle, foldArtist } = require('./release-fold.js');

const CACHE = path.join(__dirname, 'cache', 'history.json');

const args = process.argv.slice(2);
const argNum = (name, dflt) => {
  const a = args.find((x) => x.startsWith('--' + name + '='));
  return a ? parseFloat(a.split('=')[1]) : dflt;
};

const COVERAGE_FULL = argNum('full', 0.5);
const SHOW_LIST = args.includes('--list');

if (!fs.existsSync(CACHE)) {
  console.log('No cached history. Run: node scripts/fold/release-fold.js --pull');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(CACHE, 'utf-8'));

// --- normalize a track title for joining -----------------------------------
// Track names disagree across sources far more than album names do: featured
// artists, remaster tags and bracketed junk all attach to the title. Reuse the
// album normalizer, which already strips exactly those.
const trackKey = (artist, title) => foldArtist(artist) + '|||' + foldTitle(title).key;

// --- lifetime per-track counts ---------------------------------------------
const trackPlays = new Map();
for (const t of data.tracks) {
  const k = trackKey(t.artist, t.track);
  trackPlays.set(k, (trackPlays.get(k) || 0) + t.plays);
}

// --- fold albums into records ----------------------------------------------
const records = new Map();
for (const a of data.albums) {
  const t = foldTitle(a.album);
  const key = foldArtist(a.artist) + '|||' + t.key + (t.blocked ? '|||' + a.album.toLowerCase() : '');
  if (!records.has(key)) {
    records.set(key, { artist: a.artist, title: a.album, members: [], plays: 0 });
  }
  const r = records.get(key);
  r.members.push(a.album);
  r.plays += a.plays;
  // Display the shortest member title -- that is the edition-stripped one.
  if (a.album.length < r.title.length) r.title = a.album;
}

// --- resolve a canonical tracklist per record -------------------------------
// The denominator is the SHORTEST plausible member, never the union. Using the
// union would mean a deluxe listener needs 50% of 25 tracks where a standard
// listener needs 50% of 12.
const lists = data.tracklists;
for (const r of records.values()) {
  let best = null;
  for (const m of r.members) {
    const list = lists[r.artist + '|||' + m];
    if (!list || list.length < 5) continue;
    if (!best || list.length < best.length) best = list;
  }
  r.tracklist = best;
}

// --- score every record -----------------------------------------------------
const scored = [];
for (const r of records.values()) {
  if (!r.tracklist) continue; // no denominator -> cannot judge coverage
  const per = r.tracklist.map((name) => trackPlays.get(trackKey(r.artist, name)) || 0);
  const heardCounts = per.filter((n) => n > 0);
  const heard = heardCounts.length;
  const cov = heard / r.tracklist.length;
  scored.push({
    artist: r.artist,
    title: r.title,
    editions: r.members.length,
    len: r.tracklist.length,
    heard,
    cov,
    plays: r.plays,
    lo: heard ? Math.min.apply(null, heardCounts) : 0,
    hi: heard ? Math.max.apply(null, heardCounts) : 0,
  });
}

const pressed = scored.filter((r) => r.cov >= COVERAGE_FULL);
const test = scored.filter((r) => r.cov > 0 && r.cov < COVERAGE_FULL);
const unheard = scored.filter((r) => r.heard === 0);

// --- report -----------------------------------------------------------------
const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) : '0.0');

console.log('');
console.log('SHELF v2 -- folding applied, test pressings included');
console.log('='.repeat(72));
console.log('  history           : ' + data.pulledAt.slice(0, 10) + '  (' + data.user + ')');
console.log('  album entries     : ' + data.albums.length);
console.log('  records after fold: ' + records.size);
console.log('  judgeable (have a tracklist): ' + scored.length);
console.log('');
console.log('  PRESSED  (>=' + (COVERAGE_FULL * 100).toFixed(0) + '% heard) : ' + pressed.length);
console.log('  TEST     (partial)          : ' + test.length);
console.log('  unheard                     : ' + unheard.length);
console.log('');
console.log('  CRATE SIZE = pressed + test = ' + (pressed.length + test.length));
console.log('  ...against ' + pressed.length + ' under the old pressed-only rule');
console.log('');

// Coverage threshold sweep -- the shape of the rule, not one point on it.
console.log('  Shelf size by threshold:');
for (const th of [0.3, 0.4, 0.5, 0.6, 0.7, 0.8]) {
  const p = scored.filter((r) => r.cov >= th).length;
  const t = scored.filter((r) => r.cov > 0 && r.cov < th).length;
  const mark = Math.abs(th - COVERAGE_FULL) < 1e-9 ? '  <-- current' : '';
  console.log(
    '    >=' + (th * 100).toFixed(0).padStart(2) + '%  pressed ' + String(p).padStart(4) +
    '   test ' + String(t).padStart(4) + '   crate ' + String(p + t).padStart(4) + mark
  );
}
console.log('');

// A test pressing that exists after ONE track floods the crate with blanks.
// Measured 2026-08-17: pressing on first contact makes 88.8% of the crate white
// labels, which is not a shelf anyone would screenshot. So the real design
// parameter is not the promotion threshold, it is the FLOOR -- how much contact
// earns a test pressing at all.
console.log('  Test-pressing floor (min distinct tracks before a white label exists):');
console.log('    floor   pressed   test   crate   % blank');
for (const floor of [1, 2, 3, 4, 5, 6]) {
  const p = scored.filter((r) => r.cov >= COVERAGE_FULL);
  const t = scored.filter((r) => r.cov < COVERAGE_FULL && r.heard >= floor);
  const crate = p.length + t.length;
  console.log(
    '    ' + String(floor).padStart(3) + '     ' + String(p.length).padStart(4) +
    '    ' + String(t.length).padStart(4) + '   ' + String(crate).padStart(4) +
    '    ' + pct(t.length, crate).padStart(5) + '%'
  );
}
console.log('');

// Wear spread -- the thing that makes the object worth rendering.
const withSpread = pressed.filter((r) => r.lo > 0 && r.hi > r.lo);
const ratios = withSpread.map((r) => r.hi / r.lo).sort((a, b) => a - b);
if (ratios.length) {
  const median = ratios[Math.floor(ratios.length / 2)];
  console.log('  Wear spread within a pressed record (max play / min play):');
  console.log('    records with any spread : ' + withSpread.length + ' of ' + pressed.length);
  console.log('    median spread           : ' + median.toFixed(1) + 'x');
  console.log('    widest                  : ' + ratios[ratios.length - 1].toFixed(1) + 'x');
  console.log('    flat (no spread at all) : ' + (pressed.length - withSpread.length));
  console.log('');
}

// How much of the crate is test pressings? That is the cold-start answer.
console.log('  Cold-start read:');
console.log('    ' + pct(test.length, pressed.length + test.length) + '% of the crate would be white-label test pressings');
console.log('    ' + pct(pressed.length, pressed.length + test.length) + '% would be full pressings');
console.log('');

if (SHOW_LIST) {
  console.log('='.repeat(72));
  console.log('PRESSED');
  for (const r of pressed.sort((a, b) => b.plays - a.plays)) {
    const ed = r.editions > 1 ? ' [' + r.editions + ' editions folded]' : '';
    console.log(
      '  ' + String(r.plays).padStart(4) + 'p  ' + r.heard + '/' + r.len +
      ' (' + (r.cov * 100).toFixed(0) + '%)  wear ' + r.lo + '-' + r.hi + 'x  ' +
      r.artist + ' - ' + r.title + ed
    );
  }
  console.log('');
  console.log('TEST PRESSINGS (top 30 by plays)');
  for (const r of test.sort((a, b) => b.plays - a.plays).slice(0, 30)) {
    console.log(
      '  ' + String(r.plays).padStart(4) + 'p  ' + r.heard + '/' + r.len +
      ' (' + (r.cov * 100).toFixed(0) + '%)  ' + r.artist + ' - ' + r.title
    );
  }
}
console.log('');
