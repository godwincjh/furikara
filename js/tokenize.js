'use strict';

/* ================================================================
   Versecue — tokenizing & song model (kuromoji, per-category line builders, LCS re-save, migration)
   ================================================================ */

/* ---------------- tokenizer ---------------- */

function ensureTokenizer(onStatus) {
  if (tokenizer) return Promise.resolve(tokenizer);
  if (!tokenizerPromise) {
    onStatus && onStatus('Loading dictionary… (first time takes a moment)');
    tokenizerPromise = new Promise((resolve, reject) => {
      kuromoji.builder({ dicPath: 'dict/' }).build((err, tk) => {
        if (err) { tokenizerPromise = null; reject(err); return; }
        tokenizer = tk;
        resolve(tk);
      });
    });
  }
  return tokenizerPromise;
}

/* ---------------- lyrics tokenizing ---------------- */

function rawLines(text) {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

function buildLineFresh(text) {
  if (!text.trim()) return { gap: true };
  const toks = applyCounterReadings(tokenizer.tokenize(text).map(t => ({
    s: t.surface_form,
    r: (t.reading && t.reading !== '*') ? t.reading : null,
  })));
  return { toks, groups: [], romajiGroups: [], hangulGroups: [] };
}

function lineText(line) {
  return line.gap ? '' : line.toks.map(t => t.s).join('');
}


function buildKoreanLineFresh(text) {
  if (!text.trim()) return { gap: true };
  const toks = [];
  for (const part of text.split(/(\s+)/)) {
    if (part === '') continue;
    toks.push({ s: part, r: hasHangul(part) ? romanizeWord(part) : null });
  }
  return { toks, groups: [], katakanaGroups: [] };
}

/* ---------------- chinese pinyin ---------------- */

const HANZI_RE = /[一-鿿㐀-䶿]/;
function isHanzi(ch) { return HANZI_RE.test(ch); }

/*
 * One token per character (not per word) — standard hanyu pinyin practice
 * annotates every hanzi with its own syllable. pinyin-pro is still given
 * the whole line at once so it can use word-segmentation context to
 * disambiguate polyphonic characters (银行 → háng not xíng; 了 → liǎo in
 * 了解 vs. le elsewhere), then the per-character array it returns is
 * matched back up 1:1 with the characters.
 */
function buildChineseLineFresh(text) {
  if (!text.trim()) return { gap: true };
  const chars = Array.from(text);
  let readings = window.pinyinPro ? window.pinyinPro.pinyin(text, { type: 'array' }) : [];
  if (readings.length !== chars.length) {
    // defensive fallback if the library's output ever doesn't line up 1:1 — reprocess character by character
    readings = chars.map(ch => (window.pinyinPro ? window.pinyinPro.pinyin(ch, { type: 'array' })[0] : null));
  }
  const toks = chars.map((ch, i) => ({ s: ch, r: isHanzi(ch) ? (readings[i] || null) : null }));
  return { toks, groups: [] };
}

/* ---------------- english (plain, no reading layer) ---------------- */

function buildEnglishLineFresh(text) {
  if (!text.trim()) return { gap: true };
  return { toks: [{ s: text, r: null }], groups: [] };
}

/*
 * Longest-common-subsequence alignment between two arrays (by value
 * equality). Returns increasing [ai, bi] index pairs for matched items.
 */
function lcsMatch(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

/*
 * Retokenize one changed line, carrying forward any custom furigana group
 * whose member tokens all still exist, in order, with nothing inserted
 * between them. Groups that lost a member (or got split) are dropped —
 * those tokens fall back to the dictionary's default reading.
 */
function carryForwardGroupsList(oldGroups, oldToNew) {
  const groups = [];
  for (const g of (oldGroups || [])) {
    let ok = true, mappedStart = null, mappedEnd = null, prevNi = null;
    for (let oi = g.start; oi <= g.end; oi++) {
      const ni = oldToNew.get(oi);
      if (ni === undefined || (prevNi !== null && ni !== prevNi + 1)) { ok = false; break; }
      if (mappedStart === null) mappedStart = ni;
      mappedEnd = ni;
      prevNi = ni;
    }
    if (ok) groups.push({ start: mappedStart, end: mappedEnd, reading: g.reading });
  }
  return groups;
}

function carryForwardLine(oldLine, newRawText, buildFresh) {
  const fresh = buildFresh(newRawText);
  if (fresh.gap || oldLine.gap) return fresh;
  const hasOldGroups = ['groups', 'romajiGroups', 'hangulGroups', 'katakanaGroups']
    .some(key => oldLine[key] && oldLine[key].length);
  if (!hasOldGroups) return fresh;

  const oldSurfaces = oldLine.toks.map(t => t.s);
  const newSurfaces = fresh.toks.map(t => t.s);
  const oldToNew = new Map(lcsMatch(oldSurfaces, newSurfaces));

  fresh.groups = carryForwardGroupsList(oldLine.groups, oldToNew);
  // The extra override layers only exist on the categories that use them
  // (buildLineFresh/buildKoreanLineFresh set them) — carry forward whichever
  // ones this line's fresh rebuild actually has, leave others untouched.
  for (const key of ['romajiGroups', 'hangulGroups', 'katakanaGroups']) {
    if (key in fresh) fresh[key] = carryForwardGroupsList(oldLine[key], oldToNew);
  }
  return fresh;
}

/*
 * Re-tokenize a whole song's lyrics after an edit, preserving existing
 * furigana edits for lines/words that are unchanged. Lines with identical
 * text are reused verbatim; lines that changed are diffed word-by-word
 * against their old counterpart (when the edit region has an equal number
 * of old and new lines, so the pairing is unambiguous) and otherwise
 * rebuilt fresh.
 */
function mergeRetokenize(oldSong, newRawText, buildFresh) {
  const oldLines = oldSong.lines;
  const oldRaw = oldLines.map(lineText);
  const newRaw = rawLines(newRawText);
  const pairs = lcsMatch(oldRaw, newRaw);

  const result = [];
  let pIdx = 0, newI = 0, oldGapStart = 0;

  while (newI < newRaw.length) {
    if (pIdx < pairs.length && pairs[pIdx][1] === newI) {
      result.push(oldLines[pairs[pIdx][0]]);
      oldGapStart = pairs[pIdx][0] + 1;
      pIdx++;
      newI++;
    } else {
      const newGapEnd = pIdx < pairs.length ? pairs[pIdx][1] : newRaw.length;
      const oldGapEnd = pIdx < pairs.length ? pairs[pIdx][0] : oldLines.length;
      const newGap = newRaw.slice(newI, newGapEnd);
      const oldGapLines = oldLines.slice(oldGapStart, oldGapEnd);
      if (oldGapLines.length === newGap.length) {
        for (let k = 0; k < newGap.length; k++) result.push(carryForwardLine(oldGapLines[k], newGap[k], buildFresh));
      } else {
        for (const t of newGap) result.push(buildFresh(t));
      }
      newI = newGapEnd;
      oldGapStart = oldGapEnd;
    }
  }
  return result;
}


/* ---------------- migration ---------------- */

// Songs fetched from Public Lists or a friend's shared list don't go
// through migrateSong (that's only for the local library), so anywhere
// that needs a song's category reads it through here instead of
// song.category directly.
function songCategory(song) {
  return song.category || 'japanese';
}

function migrateSong(song) {
  if (!song.category) song.category = 'japanese';
  const extraKeys = song.category === 'japanese' ? ['romajiGroups', 'hangulGroups']
    : song.category === 'korean' ? ['katakanaGroups']
    : [];
  if (!song.overrideOne && !song.overrideAll) {
    song.lines.forEach(line => {
      if (line.gap) return;
      if (!line.groups) line.groups = [];
      for (const key of extraKeys) if (!line[key]) line[key] = [];
    });
    return;
  }
  song.lines.forEach((line, li) => {
    if (line.gap) return;
    line.groups = [];
    for (const key of extraKeys) line[key] = line[key] || [];
    line.toks.forEach((tok, ti) => {
      const one = song.overrideOne && song.overrideOne[`${li}:${ti}`];
      const all = song.overrideAll && song.overrideAll[tok.s];
      const reading = one !== undefined ? one : all;
      if (reading !== undefined) line.groups.push({ start: ti, end: ti, reading });
    });
  });
  delete song.overrideOne;
  delete song.overrideAll;
}

