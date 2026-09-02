'use strict';

/**
 * Normalizer test. No network, no cache, runs in milliseconds.
 *
 * The point of this file is the SEPARATE section: pairs that must NOT fold. A
 * false merge silently destroys a record and its wear, so every one of those is
 * worth more than any merge this thing gets right.
 *
 *   node scripts/fold/fold-test.js
 */

const { foldTitle, foldArtist } = require('./release-fold.js');

const key = (artist, album) => `${foldArtist(artist)}|||${foldTitle(album).key}`;

let pass = 0;
let fail = 0;

function same(artist, a, b, why) {
  const ka = key(artist, a);
  const kb = key(artist, b);
  if (ka === kb) { pass++; return; }
  fail++;
  console.log(`  FAIL (should fold)  ${why}`);
  console.log(`      ${a}   -> ${ka}`);
  console.log(`      ${b}   -> ${kb}`);
}

function different(artist, a, b, why) {
  const ka = key(artist, a);
  const kb = key(artist, b);
  const blockedA = foldTitle(a).blocked;
  const blockedB = foldTitle(b).blocked;
  // A blocking token keeps the raw title in the key upstream, so equal fold keys
  // are still distinct records if either side was blocked.
  if (ka !== kb || blockedA || blockedB) { pass++; return; }
  fail++;
  console.log(`  FAIL (must NOT fold)  ${why}`);
  console.log(`      ${a}   -> ${ka}`);
  console.log(`      ${b}   -> ${kb}`);
}

console.log('');
console.log('MUST FOLD -- same release group, different edition');
console.log('-'.repeat(70));

same('Kendrick Lamar', 'good kid, m.A.A.d city', 'good kid, m.A.A.d city (Deluxe)', 'deluxe');
same('Frank Ocean', 'Blonde', 'Blonde (Explicit)', 'explicit tag');
same('Radiohead', 'OK Computer', 'OK Computer (2017 Remaster)', 'year remaster');
same('Radiohead', 'OK Computer', 'OK Computer [Remastered]', 'square brackets');
same('The Weeknd', 'After Hours', 'After Hours (Deluxe Edition)', 'deluxe edition');
same('Tyler, The Creator', 'IGOR', 'IGOR - Deluxe Edition', 'dash suffix');
same('Nirvana', 'Nevermind', 'Nevermind (20th Anniversary Edition)', 'ordinal anniversary');
same('Beyonce', 'Lemonade', 'Lemonade (Bonus Track Version)', 'bonus track version');
same('Drake', 'Take Care', 'Take Care (Deluxe) [Explicit]', 'two stacked brackets');
same('Pink Floyd', 'The Wall', 'The Wall (Disc 1)', 'disc marker');
same('Beyonce', 'Lemonade', 'Lemonade (Expanded Edition)', 'expanded');
same('Adele', '21', '21 (Target Exclusive)', 'retailer exclusive');
same('Bjork', 'Homogenic', 'Homogénic', 'diacritics');

console.log('');
console.log('MUST NOT FOLD -- genuinely different releases');
console.log('-'.repeat(70));

different('Nirvana', 'Nevermind', 'Nevermind (Live)', 'live album is a different release group');
different('Eric Clapton', 'Unplugged', 'Unplugged (Acoustic)', 'acoustic');
different('Daft Punk', 'Discovery', 'Discovery (Remixes)', 'remix album');
different('Radiohead', 'OK Computer', 'OK Computer (Instrumental)', 'instrumental');
different('Various Artists', 'Purple Rain', 'Purple Rain (Soundtrack)', 'soundtrack is not the studio album');
different('Kanye West', 'Late Registration', 'Late Registration (Demos)', 'demos');
different('Arctic Monkeys', 'AM', 'AM (MTV Unplugged)', 'unplugged session');
different('Sufjan Stevens', 'Illinois', 'Michigan', 'unrelated albums');
different('Led Zeppelin', 'Led Zeppelin II', 'Led Zeppelin III', 'numbered series');
different('Various', 'NOW 40', 'NOW 41', 'numbered compilations');
different('Taylor Swift', '1989', '1989 (Taylor\'s Version)', 'rerecording is its own release group');
different('Kendrick Lamar', 'DAMN.', 'DAMN. COLLECTORS EDITION.', 'reversed-tracklist edition, and it is not bracketed');

// Regression, found against real history 2026-08-17: symbol-only titles all
// stripped to an empty key and folded into a single record.
different('Ed Sheeran', '÷', '=', 'symbol titles are different albums');
different('Ed Sheeran', '÷ (Deluxe)', '=', 'symbol title with an edition suffix');
different('Ed Sheeran', '+', 'x', 'plus and multiply');
same('Ed Sheeran', '÷', '÷ (Deluxe)', 'symbol title still folds its own editions');

// Soundtracks: the OST is the album, so its editions must still fold, while it
// stays distinct from any same-named studio release. Audited 2026-08-17.
same(
  'Hans Zimmer',
  'Interstellar (Original Motion Picture Soundtrack)',
  'Interstellar (Original Motion Picture Soundtrack) [Expanded Edition]',
  'OST editions fold together'
);
different('Hans Zimmer', 'Interstellar', 'Interstellar (Original Motion Picture Soundtrack)', 'OST is not the studio album');
same(
  'A.R. Rahman',
  'Vaaranam Aayiram (Original Motion Picture Soundtrack)',
  'Vaaranam Aayiram (Original Motion Picture Soundtrack) [Deluxe]',
  'film-music OST folds its editions'
);

console.log('');
console.log('ARTIST FOLDING');
console.log('-'.repeat(70));

const artistSame = (a, b, why) => {
  if (foldArtist(a) === foldArtist(b)) { pass++; return; }
  fail++;
  console.log(`  FAIL  ${why}: ${foldArtist(a)} != ${foldArtist(b)}`);
};

artistSame('Simon & Garfunkel', 'Simon and Garfunkel', 'ampersand');
artistSame('Drake', 'Drake feat. Rihanna', 'feature credit');
artistSame('Beyonce', 'Beyoncé', 'diacritics');
artistSame('Tyler, The Creator', 'Tyler The Creator', 'punctuation');

console.log('');
console.log('='.repeat(70));
console.log(`  ${pass} passed, ${fail} failed`);
console.log('');
process.exit(fail === 0 ? 0 : 1);
