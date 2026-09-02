'use strict';

/**
 * Reads the JSONL written by smtc-dump.ps1 and reports how trustworthy each
 * source application's metadata actually is.
 *
 * DeadWax presses one record per album, so the album title is load-bearing. This
 * report exists to answer, with numbers rather than assumption:
 *
 *   1. Which sources supply an album title at all?
 *   2. Which pack "Artist - Album" into one field? (suspected: Apple Music)
 *   3. Which supply junk titles that are not tracks? (suspected: browser tabs)
 *   4. Does a source populate SMTC at all? (open question: SoundCloud in Chrome)
 *
 * Usage:
 *   node scripts/smtc/smtc-report.js                 # newest dump
 *   node scripts/smtc/smtc-report.js <path.jsonl>    # a specific dump
 *   node scripts/smtc/smtc-report.js --all           # every dump, merged
 *
 * ASCII output only -- this is a Windows console.
 */

const fs = require('fs');
const path = require('path');

const DUMP_DIR = path.join(__dirname, 'dump');

// ---------------------------------------------------------------- load

function dumpFiles() {
  if (!fs.existsSync(DUMP_DIR)) return [];
  return fs
    .readdirSync(DUMP_DIR)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => path.join(DUMP_DIR, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

function load(files) {
  const rows = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf-8');
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        rows.push(JSON.parse(line));
      } catch {
        // A partial final line is normal if the dump was Ctrl-C'd mid-write.
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------- tests
//
// Each returns true when the field is BAD for our purposes. Every one of these
// is a reason a record would press wrong, or not press at all.

const blank = (s) => s === null || s === undefined || String(s).trim() === '';

const norm = (s) => String(s || '').trim().toLowerCase();

// "Artist - Album" or "Artist -- Album" crammed into a single field. Apple Music
// for Windows is the suspect. An en/em dash surrounded by spaces is the tell;
// a hyphen inside a word (Jay-Z, Wu-Tang) is not.
const PACKED = /\s[-‐-―−]\s/;

// Shapes that only ever appear in browser-tab titles, never on a record.
const JUNK_TITLE = [
  /\bofficial\s+(music\s+)?video\b/i,
  /\bofficial\s+audio\b/i,
  /\blyrics?\s*(video)?\b/i,
  /\b(hd|hq|4k|1080p|720p)\b/i,
  /\bfull\s+album\b/i,
  /\[[^\]]*\]/, // bracketed tags: [Official], [FREE], [NCS Release]
  /\|/,         // pipe-separated uploader junk
  /\bvisuali[sz]er\b/i,
  /\bslowed|reverb|sped\s*up\b/i,
];

const isJunkTitle = (t) => JUNK_TITLE.some((re) => re.test(String(t || '')));

// ---------------------------------------------------------------- aggregate

function summarise(rows) {
  const bySource = new Map();

  for (const r of rows) {
    const key = r.sourceApp || '<unknown>';
    if (!bySource.has(key)) {
      bySource.set(key, {
        source: key,
        rows: [],
        seen: new Set(),
      });
    }
    const bucket = bySource.get(key);
    bucket.rows.push(r);
    bucket.seen.add(`${norm(r.artist)}|${norm(r.title)}|${norm(r.albumTitle)}`);
  }

  const out = [];
  for (const bucket of bySource.values()) {
    const rs = bucket.rows;
    const n = rs.length;
    const pct = (count) => (n === 0 ? 0 : Math.round((count / n) * 100));

    out.push({
      source: bucket.source,
      n,
      distinct: bucket.seen.size,
      noAlbum: pct(rs.filter((r) => blank(r.albumTitle)).length),
      albumIsTitle: pct(
        rs.filter((r) => !blank(r.albumTitle) && norm(r.albumTitle) === norm(r.title)).length
      ),
      noAlbumArtist: pct(rs.filter((r) => blank(r.albumArtist)).length),
      packedArtist: pct(rs.filter((r) => PACKED.test(String(r.artist || ''))).length),
      packedTitle: pct(rs.filter((r) => PACKED.test(String(r.title || ''))).length),
      junkTitle: pct(rs.filter((r) => isJunkTitle(r.title)).length),
      noTrackNum: pct(rs.filter((r) => !r.trackNumber).length),
      noTrackCount: pct(rs.filter((r) => !r.albumTrackCount).length),
      noDuration: pct(rs.filter((r) => !r.durationSec).length),
      genres: pct(rs.filter((r) => Array.isArray(r.genres) && r.genres.length > 0).length),
    });
  }

  return out.sort((a, b) => b.n - a.n);
}

// A source is usable for album-level pressing only if it names the album most of
// the time and does not corrupt the artist field getting there.
function verdict(s) {
  if (s.noAlbum >= 80) return 'UNUSABLE  - no album title; track-only';
  if (s.packedArtist >= 30 || s.packedTitle >= 30) return 'NEEDS UNPACK - fields are concatenated';
  if (s.junkTitle >= 30) return 'NEEDS CLEANUP - browser-tab titles';
  if (s.noAlbum >= 30) return 'PARTIAL   - album often missing';
  if (s.albumIsTitle >= 50) return 'SINGLES   - album mirrors title';
  return 'GOOD      - album-level pressing viable';
}

// ---------------------------------------------------------------- render

function bar(label, value) {
  const filled = Math.round(value / 5);
  return `    ${label.padEnd(22)} ${String(value).padStart(3)}%  ${'#'.repeat(filled)}`;
}

function main() {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const explicit = args.find((a) => !a.startsWith('--'));

  let files;
  if (explicit) files = [explicit];
  else if (all) files = dumpFiles();
  else files = dumpFiles().slice(0, 1);

  if (files.length === 0) {
    console.log('No dumps found in scripts/smtc/dump/.');
    console.log('Run:  powershell -ExecutionPolicy Bypass -File scripts\\smtc\\smtc-dump.ps1 -Minutes 60');
    process.exit(1);
  }

  const rows = load(files);
  if (rows.length === 0) {
    console.log('Dump files exist but contain no records. Was anything playing?');
    process.exit(1);
  }

  console.log('');
  console.log('SMTC FIELD QUALITY');
  console.log('='.repeat(72));
  for (const f of files) console.log(`  ${path.relative(process.cwd(), f)}`);
  console.log(`  ${rows.length} records, ${new Set(rows.map((r) => r.sourceApp)).size} sources`);
  console.log('');

  const summary = summarise(rows);

  for (const s of summary) {
    console.log('-'.repeat(72));
    console.log(`  ${s.source}`);
    console.log(`  ${s.n} records, ${s.distinct} distinct tracks`);
    console.log(`  ${verdict(s)}`);
    console.log('');
    console.log(bar('no album title', s.noAlbum));
    console.log(bar('album == title', s.albumIsTitle));
    console.log(bar('no album artist', s.noAlbumArtist));
    console.log(bar('packed artist field', s.packedArtist));
    console.log(bar('packed title field', s.packedTitle));
    console.log(bar('browser-junk title', s.junkTitle));
    console.log(bar('no track number', s.noTrackNum));
    console.log(bar('no album track count', s.noTrackCount));
    console.log(bar('no duration', s.noDuration));
    console.log(bar('has genres', s.genres));
    console.log('');
  }

  // The four questions this dump exists to answer.
  console.log('='.repeat(72));
  console.log('ANSWERS');
  console.log('');

  const named = (frag) =>
    summary.filter((s) => s.source.toLowerCase().includes(frag));

  const q = (question, matches, answer) => {
    console.log(`  Q: ${question}`);
    if (matches.length === 0) {
      console.log('  A: NOT OBSERVED - no records from this source in the dump.');
    } else {
      for (const m of matches) console.log(`  A: ${answer(m)}`);
    }
    console.log('');
  };

  q(
    'Does Apple Music for Windows pack "Artist - Album" into one field?',
    named('applemusic').concat(named('apple music')),
    (m) =>
      `${m.source}: artist packed ${m.packedArtist}%, title packed ${m.packedTitle}%, ` +
      `no album ${m.noAlbum}%`
  );

  q(
    'Does SoundCloud in a browser populate SMTC?',
    summary.filter((s) => /chrome|edge|firefox|msedge/i.test(s.source)),
    (m) => `${m.source}: ${m.n} records, no album ${m.noAlbum}%, junk titles ${m.junkTitle}%`
  );

  const albumCapable = summary.filter((s) => s.noAlbum < 30);
  console.log('  Q: Which sources can drive album-level pressing unaided?');
  if (albumCapable.length === 0) {
    console.log('  A: NONE. Every source needs a resolution layer.');
  } else {
    for (const m of albumCapable) console.log(`  A: ${m.source} (album present ${100 - m.noAlbum}%)`);
  }
  console.log('');

  const weighted =
    rows.filter((r) => blank(r.albumTitle)).length / rows.length;
  console.log('  Q: Overall, how often is there no album title to press against?');
  console.log(`  A: ${Math.round(weighted * 100)}% of all observed track changes.`);
  console.log('');
  console.log('='.repeat(72));
}

main();
