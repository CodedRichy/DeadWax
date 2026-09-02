'use strict';

/**
 * Tests for the SMTC cleanup layer. No network, runs instantly.
 *
 * Every case marked REAL was captured from this machine on 2026-08-17 and is
 * reproduced verbatim. The rest are shapes the same sources are known to emit.
 *
 *   node scripts/smtc/resolve-test.js
 */

const { isMusic, unpackTitle, resolve } = require('./resolve.js');

let pass = 0;
let fail = 0;

function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; return; }
  fail++;
  console.log(`  FAIL  ${label}`);
  console.log(`      got  ${JSON.stringify(got)}`);
  console.log(`      want ${JSON.stringify(want)}`);
}

const music = (s) => isMusic(s).music;

console.log('');
console.log('IS IT MUSIC?');
console.log('-'.repeat(70));

// REAL -- Spotify, captured 2026-08-17
check('spotify is trusted', music({
  sourceApp: 'Spotify.exe', title: 'Bout It', artist: 'PARTYNEXTDOOR',
  albumTitle: 'PARTYNEXTDOOR TWO', playbackType: 'Music', durationSec: 205,
}), true);

// REAL -- local file via the modern Media Player, captured 2026-08-17
check('local player is trusted', music({
  sourceApp: 'Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic',
  title: 'Denominator Test', artist: 'Test Artist', albumTitle: 'Test Album',
  playbackType: 'Music', durationSec: 45,
}), true);

// REAL -- Chrome playing a YouTube music video, captured 2026-08-17
check('youtube music video passes', music({
  sourceApp: 'Chrome',
  title: 'PARTYNEXTDOOR - MAKE IT TO THE MORNING (Official Visualizer)',
  artist: 'PARTYNEXTDOOR', albumTitle: '', playbackType: 'Music', durationSec: 168,
}), true);

// REAL -- Chrome on a Minecraft server page, captured 2026-08-17. The case that
// prompted this whole module.
check('minecraft server page rejected', music({
  sourceApp: 'Chrome', title: 'Server | Aternos | Free Minecraft Server',
  artist: '', albumTitle: '', playbackType: 'Music', durationSec: 34,
}), false);

check('podcast rejected', music({
  sourceApp: 'Chrome', title: 'Ep. 402 - The Daily Podcast',
  artist: '', albumTitle: '', durationSec: 3200,
}), false);

check('youtube tutorial rejected', music({
  sourceApp: 'Chrome', title: 'How To Build A React App - Full Course',
  artist: '', albumTitle: '', durationSec: 7200,
}), false);

check('declared video rejected', music({
  sourceApp: 'Chrome', title: 'Some Artist - Some Song',
  artist: '', albumTitle: '', playbackType: 'Video', durationSec: 200,
}), false);

check('short clip rejected', music({
  sourceApp: 'Chrome', title: 'Artist - Song', artist: '', albumTitle: '', durationSec: 12,
}), false);

check('bare page title with no artist rejected', music({
  sourceApp: 'Chrome', title: 'Gmail', artist: '', albumTitle: '', durationSec: 300,
}), false);

check('unlisted player with an album accepted', music({
  sourceApp: 'SomeNewPlayer.exe', title: 'Track', artist: 'Artist',
  albumTitle: 'An Album', durationSec: 200,
}), true);

console.log('');
console.log('UNPACKING TITLES');
console.log('-'.repeat(70));

// REAL -- the exact shape captured from Chrome on 2026-08-17.
check('youtube: artist repeated as title prefix', unpackTitle({
  title: 'PARTYNEXTDOOR - MAKE IT TO THE MORNING (Official Visualizer)',
  artist: 'PARTYNEXTDOOR',
}), { artist: 'PARTYNEXTDOOR', track: 'MAKE IT TO THE MORNING', confidence: 'high' });

check('no artist field, dash split', unpackTitle({
  title: 'Daft Punk - Around The World (Official Video)', artist: '',
}), { artist: 'Daft Punk', track: 'Around The World', confidence: 'medium' });

check('pipe tail dropped', unpackTitle({
  title: 'Burial - Archangel | Hyperdub', artist: '',
}), { artist: 'Burial', track: 'Archangel', confidence: 'medium' });

check('stacked junk brackets', unpackTitle({
  title: 'Artist - Song (Official Music Video) [HD]', artist: '',
}), { artist: 'Artist', track: 'Song', confidence: 'medium' });

check('feat is kept, it is part of the track', unpackTitle({
  title: 'Drake - Work (feat. Rihanna) (Official Audio)', artist: '',
}), { artist: 'Drake', track: 'Work (feat. Rihanna)', confidence: 'medium' });

check('live is kept, it is a different recording', unpackTitle({
  title: 'Radiohead - Creep (Live at Glastonbury)', artist: '',
}), { artist: 'Radiohead', track: 'Creep (Live at Glastonbury)', confidence: 'medium' });

check('hyphenated name survives', unpackTitle({
  title: 'Jay-Z - Song Title', artist: '',
}), { artist: 'Jay-Z', track: 'Song Title', confidence: 'medium' });

// An artist field that nothing else confirms is usable but weak -- 'low', not
// 'high'. It was 'high' until 2026-08-19, which is what let uploader names
// through as artists.
check('unconfirmed artist field is low confidence', unpackTitle({
  title: 'Some Song', artist: 'Some Artist',
}), { artist: 'Some Artist', track: 'Some Song', confidence: 'low' });

// ---------------------------------------------------------------------------
// THE UPLOADER CASES. All five REAL, captured 2026-08-19 from SoundCloud and
// YouTube through Chrome. Every one of them wrote a record credited to a channel
// before this was fixed. One artist, four wrong names.
// ---------------------------------------------------------------------------

check('REAL: uploader "hidden gems" loses to the title', unpackTitle({
  title: 'PARTYNEXTDOOR- Something New', artist: 'hidden gems',
}), { artist: 'PARTYNEXTDOOR', track: 'Something New', confidence: 'medium' });

check('REAL: uploader "bc" loses to the title', unpackTitle({
  title: 'PARTYNEXTDOOR - Meghan Interlude', artist: 'bc',
}), { artist: 'PARTYNEXTDOOR', track: 'Meghan Interlude', confidence: 'medium' });

check('REAL: emoji channel loses to the title, bare year stripped', unpackTitle({
  title: 'PARTYNEXTDOOR- WANT ME (UNRELEASED) (2020)', artist: 'Prince Elliot \u{1F3A7}',
}), { artist: 'PARTYNEXTDOOR', track: 'WANT ME (UNRELEASED)', confidence: 'medium' });

check('REAL: url channel loses to the title', unpackTitle({
  title: "PARTYNEXTDOOR - 647 (Company) [Reference Track For Drake's Company]",
  artist: 'The New Industry® (www.thenewindustry.ml)',
}), { artist: 'PARTYNEXTDOOR',
      track: "647 (Company) [Reference Track For Drake's Company]",
      confidence: 'medium' });

// REAL, and the one this layer gets WRONG on purpose: the upload is reversed,
// TRACK - ARTIST. Nothing in the string says so. Conventional order is assumed
// and the index arbitrates later by trying both. Asserted as-is so the day it
// changes, it changes deliberately.
check('REAL: reversed upload is split conventionally, index arbitrates', unpackTitle({
  title: 'Whatever You Say - PartyNextDoor (cut the end part off lol)',
  artist: 'a.babyy ✨',
}), { artist: 'Whatever You Say',
      track: 'PartyNextDoor (cut the end part off lol)',
      confidence: 'medium' });

// No dash to fall back on, and the field is a channel -- refuse rather than
// press a record credited to it.
check('uploader-shaped field with no split is refused', unpackTitle({
  title: 'Some Leaked Thing', artist: 'Prince Elliot \u{1F3A7}',
}), null);

check('dash with no leading space still splits', unpackTitle({
  title: 'Artist Name- Track Name', artist: '',
}), { artist: 'Artist Name', track: 'Track Name', confidence: 'medium' });

// The loosened split requires whitespace AFTER the hyphen, which is the only
// thing keeping these two intact.
check('Jay-Z survives the loosened split', unpackTitle({
  title: 'Jay-Z - Song Title', artist: '',
}), { artist: 'Jay-Z', track: 'Song Title', confidence: 'medium' });

check('Wu-Tang survives with no separator at all', unpackTitle({
  title: 'Wu-Tang Clan Protect Ya Neck', artist: '',
}), null);

check('unparseable returns null, never a guess', unpackTitle({
  title: 'aternos', artist: '',
}), null);

console.log('');
console.log('FULL PIPELINE');
console.log('-'.repeat(70));

const spotify = resolve({
  sourceApp: 'Spotify.exe', title: 'Bout It', artist: 'PARTYNEXTDOOR',
  albumTitle: 'PARTYNEXTDOOR TWO', playbackType: 'Music', durationSec: 205,
});
check('spotify resolves with its own album', [spotify.ok, spotify.album, spotify.confidence],
  [true, 'PARTYNEXTDOOR TWO', 'high']);

const yt = resolve({
  sourceApp: 'Chrome',
  title: 'PARTYNEXTDOOR - MAKE IT TO THE MORNING (Official Visualizer)',
  artist: 'PARTYNEXTDOOR', albumTitle: '', playbackType: 'Music', durationSec: 168,
});
check('youtube resolves, album left for the index',
  [yt.ok, yt.artist, yt.track, yt.album], [true, 'PARTYNEXTDOOR', 'MAKE IT TO THE MORNING', null]);

const junk = resolve({
  sourceApp: 'Chrome', title: 'Server | Aternos | Free Minecraft Server',
  artist: '', albumTitle: '', playbackType: 'Music', durationSec: 34,
});
check('minecraft page refused with a reason', [junk.ok, typeof junk.reason], [false, 'string']);

console.log('');
console.log('='.repeat(70));
console.log(`  ${pass} passed, ${fail} failed`);
console.log('');
process.exit(fail === 0 ? 0 : 1);
