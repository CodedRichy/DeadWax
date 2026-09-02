'use strict';

/**
 * Apply the resolver to captured listens and write a cleaned view beside them.
 *
 *   node scripts/smtc/clean.js              # every listens-*.jsonl in dump/
 *   node scripts/smtc/clean.js 20260819     # one day
 *
 * WHY A SECOND PASS AND NOT A REWRITE
 * -----------------------------------
 * tray.ps1 writes exactly what Windows said, forever, and this never touches it.
 * The resolver is a guess -- an improving one, but a guess -- and guesses must
 * not overwrite evidence. Two consequences, both deliberate:
 *
 *   * Every improvement to resolve.js can be applied to the ENTIRE back
 *     catalogue by re-running this. A collector that cleaned on the way in
 *     would have baked 2026-08-19's mistakes into the archive permanently.
 *   * When a record on the shelf looks wrong, the raw line is still there to
 *     check it against. Without that there is no way to tell a bad capture from
 *     a bad resolve.
 *
 * This is also why the resolver lives in JS while the collector is PowerShell.
 * Porting it would have put the guessing inside the recorder.
 *
 * OUTPUT
 * ------
 * dump/resolved-YYYYMMDD.jsonl -- one line per input line, in order, carrying
 * the raw fields plus a `resolved` block. Refusals are KEPT, with their reason.
 * Dropping them would hide how much of the capture is unusable, which is one of
 * the numbers this whole exercise exists to measure.
 */

const fs = require('fs');
const path = require('path');
const { resolve } = require('./resolve.js');

const DUMP = path.join(__dirname, 'dump');

function listFiles(day) {
  if (!fs.existsSync(DUMP)) return [];
  return fs
    .readdirSync(DUMP)
    .filter((f) => /^listens-\d{8}\.jsonl$/.test(f))
    .filter((f) => (day ? f === `listens-${day}.jsonl` : true))
    .sort();
}

function cleanFile(file) {
  const src = path.join(DUMP, file);
  const day = file.match(/(\d{8})/)[1];
  const dst = path.join(DUMP, `resolved-${day}.jsonl`);

  const lines = fs.readFileSync(src, 'utf8').split('\n').filter((l) => l.trim());
  const out = [];

  const stat = {
    total: 0,
    ok: 0,
    refused: 0,
    counted: 0,
    bySource: {},
    byConfidence: { high: 0, medium: 0, low: 0 },
    byRefusal: {},
    rewritten: [],   // where the resolver disagreed with the captured artist
  };

  for (const line of lines) {
    let raw;
    try { raw = JSON.parse(line); } catch { continue; }
    stat.total++;

    // The collector's field names are not the resolver's. Map explicitly rather
    // than passing the record through -- a silent rename is a silent bug.
    const session = {
      sourceApp: raw.sourceApp,
      title: raw.title,
      artist: raw.artist,
      albumTitle: raw.albumTitle,
      playbackType: raw.playbackType,
      durationSec: raw.durationSec,
    };

    const r = resolve(session);
    const app = String(raw.sourceApp || '?').split('!')[0].replace(/\.exe$/i, '');
    stat.bySource[app] = stat.bySource[app] || { total: 0, ok: 0 };
    stat.bySource[app].total++;
    if (raw.counted) stat.counted++;

    if (r.ok) {
      stat.ok++;
      stat.bySource[app].ok++;
      stat.byConfidence[r.confidence]++;
      if (raw.artist && r.artist && raw.artist !== r.artist) {
        stat.rewritten.push({ was: raw.artist, now: r.artist, track: r.track });
      }
    } else {
      stat.refused++;
      stat.byRefusal[r.reason] = (stat.byRefusal[r.reason] || 0) + 1;
    }

    out.push(JSON.stringify({ ...raw, resolved: r }));
  }

  fs.writeFileSync(dst, out.join('\n') + '\n', 'utf8');
  return { dst: path.basename(dst), stat };
}

function pct(n, d) {
  return d === 0 ? '  0%' : String(Math.round((n / d) * 100)).padStart(3) + '%';
}

function main() {
  const day = process.argv[2];
  const files = listFiles(day);

  if (files.length === 0) {
    console.log(day ? `No capture for ${day}.` : 'No captures in dump/ yet.');
    return;
  }

  for (const file of files) {
    const { dst, stat } = cleanFile(file);
    console.log('');
    console.log(`${file}  ->  ${dst}`);
    console.log('-'.repeat(70));
    console.log(`  ${String(stat.total).padStart(4)}  captured`);
    console.log(`  ${String(stat.counted).padStart(4)}  counted as real listens by the scrobble rule`);
    console.log(`  ${String(stat.ok).padStart(4)}  resolved      ${pct(stat.ok, stat.total)}`);
    console.log(`  ${String(stat.refused).padStart(4)}  refused       ${pct(stat.refused, stat.total)}`);

    console.log('');
    console.log('  confidence');
    for (const k of ['high', 'medium', 'low']) {
      console.log(`    ${k.padEnd(7)} ${String(stat.byConfidence[k]).padStart(4)}`);
    }

    console.log('');
    console.log('  by source');
    for (const [app, s] of Object.entries(stat.bySource).sort((a, b) => b[1].total - a[1].total)) {
      console.log(`    ${app.padEnd(22)} ${String(s.ok).padStart(3)} / ${String(s.total).padEnd(3)}  ${pct(s.ok, s.total)}`);
    }

    if (stat.refused > 0) {
      console.log('');
      console.log('  refused because');
      for (const [why, n] of Object.entries(stat.byRefusal).sort((a, b) => b[1] - a[1])) {
        console.log(`    ${String(n).padStart(3)}  ${why}`);
      }
    }

    // The headline number. Every one of these would have been a record filed
    // under an uploader's channel name.
    if (stat.rewritten.length > 0) {
      console.log('');
      console.log(`  artist corrected on ${stat.rewritten.length} of ${stat.total}`);
      for (const c of stat.rewritten) {
        console.log(`    ${c.was}`);
        console.log(`      -> ${c.now}  --  ${c.track}`);
      }
    }
  }
  console.log('');
}

if (require.main === module) main();
module.exports = { cleanFile };
