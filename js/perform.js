'use strict';

/* ================================================================
   Versecue — perform view (lyrics rendering, reading modes, word selection, reading-fix modal, wake lock, font)
   ================================================================ */

/* ---------------- perform ---------------- */

// Japanese songs alone can be viewed as furigana or romaji; every other
// category only ever has one reading layer. Resets to furigana each time
// a song is opened (it's a view-time toggle, not a per-song preference).
let performReadingMode = 'furigana'; // japanese: 'furigana'|'romaji'; other categories use a single reading

// Which override-groups field on a line holds edits for the current
// category+mode combination — each extra reading layer beyond the
// category's default (furigana for japanese, romaji for korean) gets its
// own field so switching modes never clobbers another mode's edits.
function activeGroupsKey(cat, mode) {
  if (cat === 'japanese') {
    if (mode === 'romaji') return 'romajiGroups';
    if (mode === 'hangul') return 'hangulGroups';
    return 'groups'; // furigana
  }
  if (cat === 'korean' && mode === 'katakana') return 'katakanaGroups';
  return 'groups'; // korean romaji, chinese pinyin
}

// Furigana alone splits kanji from okurigana within a token (renderRubyInto);
// every other mode/category annotates the whole selected span as one unit.
function isWholeTokenMode(cat, mode) {
  return !(cat === 'japanese' && mode === 'furigana');
}

// The auto (non-overridden) reading for one token in the current mode.
function autoReadingFor(cat, mode, tok, nextTok) {
  if (cat === 'japanese') {
    if (mode === 'romaji') return tokenRomaji(tok, nextTok);
    if (mode === 'hangul') return tokenHangul(tok);
    return tok.r; // furigana
  }
  if (cat === 'korean' && mode === 'katakana') return tok.r ? hangulToKatakana(tok.s) : null;
  return tok.r; // korean romaji, chinese pinyin
}

// Which groups array is live for the current song + mode. Defaults to []
// for songs saved before a field existed, or fetched from a remote
// source that skips migrateSong.
function activeGroups(song, li) {
  const cat = songCategory(song);
  const line = song.lines[li];
  return line[activeGroupsKey(cat, performReadingMode)] || [];
}

function groupCovering(groups, ti) {
  return groups.find(g => ti >= g.start && ti <= g.end);
}

function renderRubyInto(parent, surface, reading) {
  for (const part of alignFurigana(surface, reading)) {
    if (part.ruby) {
      const ruby = document.createElement('ruby');
      ruby.appendChild(document.createTextNode(part.text));
      const rt = document.createElement('rt');
      rt.textContent = part.ruby;
      ruby.appendChild(rt);
      parent.appendChild(ruby);
    } else {
      parent.appendChild(document.createTextNode(part.text));
    }
  }
}

// Korean and Chinese romanization/pinyin apply to the whole selected span
// as one unit — no run-splitting needed the way Japanese separates kanji
// from okurigana (Chinese tokens are already one character each, and
// Korean spans a whole word, so there's nothing to split).
function renderRubyWholeToken(parent, surface, reading) {
  if (reading) {
    const ruby = document.createElement('ruby');
    ruby.appendChild(document.createTextNode(surface));
    const rt = document.createElement('rt');
    rt.textContent = reading;
    ruby.appendChild(rt);
    parent.appendChild(ruby);
  } else {
    parent.appendChild(document.createTextNode(surface));
  }
}

function langAttrFor(cat) {
  return cat === 'korean' ? 'ko' : cat === 'chinese' ? 'zh' : cat === 'english' ? 'en' : 'ja';
}

function langTagLabel(cat) {
  return cat === 'korean' ? '한국어' : cat === 'chinese' ? '中文' : cat === 'english' ? 'English' : '日本語';
}

const VIDEO_BADGE_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5.5" width="19" height="13" rx="3"/><path d="m10.5 9.5 5 2.5-5 2.5z" fill="currentColor" stroke="none"/></svg>';

// Shared row of small tags used under a song's title on every card list
// (My List, Public List, Other Lists). hasVideo means "does the copy of
// this song you're looking at right now have a video attached" — callers
// decide what that means for their context (current youtubeId for your
// own songs, originalYoutubeId-only for the public listing).
function buildSongCardTags(cat, hasVideo) {
  const wrap = document.createElement('div');
  wrap.className = 'song-card-tags';
  const tag = document.createElement('span');
  tag.className = 'song-card-lang-tag';
  tag.textContent = langTagLabel(cat);
  wrap.appendChild(tag);
  if (hasVideo) {
    const icon = document.createElement('span');
    icon.className = 'song-card-video-icon';
    icon.title = 'Has a YouTube video';
    icon.innerHTML = VIDEO_BADGE_SVG;
    wrap.appendChild(icon);
  }
  return wrap;
}

function editLabelFor(cat) {
  if (cat === 'chinese') return 'Edit Pinyin';
  if (cat === 'korean') return performReadingMode === 'katakana' ? 'Edit Katakana' : 'Edit';
  if (cat === 'japanese') {
    if (performReadingMode === 'romaji') return 'Edit Romaji';
    if (performReadingMode === 'hangul') return 'Edit Hangul';
    return 'Edit furigana';
  }
  return 'Edit furigana';
}

function buildLyricsDom(song) {
  const cont = $('lyrics-container');
  cont.innerHTML = '';
  cont.style.fontSize = fontSize + 'px';
  const cat = songCategory(song);
  const mode = performReadingMode;
  const wholeToken = isWholeTokenMode(cat, mode);
  cont.lang = langAttrFor(cat);
  song.lines.forEach((line, li) => {
    const div = document.createElement('div');
    div.dataset.li = li;
    if (line.gap) { div.className = 'line gap'; cont.appendChild(div); return; }
    div.className = 'line';
    if (cat === 'english') {
      div.textContent = lineText(line);
      cont.appendChild(div);
      return;
    }
    const groups = activeGroups(song, li);
    let ti = 0;
    while (ti < line.toks.length) {
      const g = groupCovering(groups, ti);
      const unit = document.createElement('span');
      unit.className = 'unit';
      const start = g ? g.start : ti;
      const end = g ? g.end : ti;
      unit.dataset.li = li;
      unit.dataset.start = start;
      unit.dataset.end = end;
      const surface = line.toks.slice(start, end + 1).map(t => t.s).join('');
      const reading = g ? g.reading : autoReadingFor(cat, mode, line.toks[ti], line.toks[ti + 1]);
      if (!wholeToken) renderRubyInto(unit, surface, reading);
      else renderRubyWholeToken(unit, surface, reading);
      div.appendChild(unit);
      ti = end + 1;
    }
    cont.appendChild(div);
  });
  applySelectionHighlight();
}

const READING_MODE_BUTTONS = { furigana: 'mode-btn-furigana', romaji: 'mode-btn-romaji' };
const READING_MODES_BY_CATEGORY = { japanese: ['furigana', 'romaji'] };

// Shows only the mode buttons applicable to this song's category. The row
// only appears when there's an actual choice (≥2 modes) — so Japanese gets
// the あ/A toggle, and korean/chinese/english show their single reading with
// no toggle at all. The "Update romaji" helper rides in this row too, but
// only for editable Japanese songs.
function updateReadingModeButtons(cat) {
  const modes = READING_MODES_BY_CATEGORY[cat];
  const show = !!modes && modes.length >= 2;
  $('reading-mode-row').classList.toggle('hidden', !show);
  for (const key in READING_MODE_BUTTONS) {
    const btn = $(READING_MODE_BUTTONS[key]);
    const applicable = show && modes.includes(key);
    btn.classList.toggle('hidden', !applicable);
    btn.classList.toggle('active', applicable && key === performReadingMode);
  }
  $('btn-sync-romaji').classList.toggle('hidden', !(cat === 'japanese' && !performReadOnly));
}

// One-tap: rebuild each line's romaji overrides from the furigana readings the
// user has set, so the romaji view matches the furigana they just finished.
// Non-overridden words already share the same source reading (tok.r), so only
// the manual furigana fixes need mirroring across. Japanese, editable songs only.
function syncRomajiFromFurigana() {
  if (!currentSong || performReadOnly || songCategory(currentSong) !== 'japanese') return;
  for (const line of currentSong.lines) {
    if (line.gap) continue;
    line.romajiGroups = (line.groups || []).map(g => ({
      start: g.start, end: g.end, reading: kanaToRomaji(g.reading),
    }));
  }
  saveSongs();
  if (performReadingMode === 'romaji') buildLyricsDom(currentSong);
  showToast('Romaji updated from your furigana ✓');
}

function openPerform(song) {
  currentSong = song;
  selection = null;
  const cat = songCategory(song);
  performReadingMode = cat === 'korean' ? 'romaji' : 'furigana';
  updateReadingModeButtons(cat);
  $('perform-song-title').textContent = song.title;
  $('perform-song-title').lang = langAttrFor(cat);
  $('perform-edit-hint').classList.toggle('hidden', performReadOnly || cat === 'english');
  $('btn-perform-home').classList.toggle('invisible', !performReadOnly);
  $('btn-sel-edit').textContent = editLabelFor(cat);
  stopYoutubePanel();
  updatePerformAddButton();
  buildLyricsDom(song);
  updateSelectionBar();
  showView('perform');
}

// Mirrors the same disabled/title logic as the Add to List buttons in the
// Public List and Other Lists card views, just re-evaluated for whatever
// song is currently open. Only relevant while previewing someone else's
// song (performReadOnly) — hidden entirely for your own songs.
function updatePerformAddButton() {
  const btn = $('btn-perform-add');
  btn.classList.toggle('hidden', !performReadOnly);
  if (!performReadOnly) return;
  const id = currentSong && currentSong.id;
  const ownPublish = !!(id && songs.some(s => s.publishId === id));
  const alreadyAdded = !!(id && songs.some(s => s.importedFrom === id));
  btn.disabled = !id || ownPublish || alreadyAdded;
  btn.title = ownPublish ? 'This is already in My List — you published it'
    : alreadyAdded ? 'Already in My List'
    : 'Add to List';
}


/* ---------------- word selection (disabled in read-only mode) ---------------- */

function onUnitClick(e) {
  if (performReadOnly || songCategory(currentSong) === 'english') return;
  const unit = e.target.closest('.unit');
  if (!unit) return;
  const li = parseInt(unit.dataset.li, 10);
  const start = parseInt(unit.dataset.start, 10);
  const end = parseInt(unit.dataset.end, 10);
  handleUnitTap(li, start, end);
}

function handleUnitTap(li, start, end) {
  if (!selection || selection.li !== li) {
    selection = { li, anchorStart: start, anchorEnd: end, start, end };
  } else if (selection.start === start && selection.end === end &&
             selection.anchorStart === start && selection.anchorEnd === end) {
    selection = null;
  } else {
    selection = {
      li,
      anchorStart: selection.anchorStart,
      anchorEnd: selection.anchorEnd,
      start: Math.min(selection.anchorStart, start),
      end: Math.max(selection.anchorEnd, end),
    };
  }
  applySelectionHighlight();
  updateSelectionBar();
}

function applySelectionHighlight() {
  document.querySelectorAll('.unit.selected').forEach(u => u.classList.remove('selected'));
  if (!selection) return;
  document.querySelectorAll(`.unit[data-li="${selection.li}"]`).forEach(u => {
    const s = parseInt(u.dataset.start, 10), e = parseInt(u.dataset.end, 10);
    if (s >= selection.start && e <= selection.end) u.classList.add('selected');
  });
}

function updateSelectionBar() {
  const bar = $('selection-bar');
  if (performReadOnly || !selection) { bar.classList.add('hidden'); return; }
  const n = selection.end - selection.start + 1;
  $('selection-count').textContent = n === 1 ? '1 word selected' : n + ' words selected';
  bar.classList.remove('hidden');
}

function clearSelection() {
  selection = null;
  applySelectionHighlight();
  updateSelectionBar();
}

/* ---------------- reading-fix modal ---------------- */

/*
 * Look up every distinct dictionary reading for an exact surface string,
 * by querying kuromoji's own trie + token dictionary directly (there's no
 * public API for this — tokenize() only returns the one reading picked
 * for the sentence's context).
 */
function dictionaryReadings(surface) {
  if (!tokenizer) return [];
  try {
    const cps = tokenizer.viterbi_builder.trie.commonPrefixSearch(surface);
    const exact = cps.find(e => e.k === surface);
    if (!exact) return [];
    const wordIds = tokenizer.token_info_dictionary.target_map[exact.v] || [];
    const readings = new Set();
    for (const id of wordIds) {
      const reading = tokenizer.token_info_dictionary.getFeatures(id).split(',')[8];
      if (reading && reading !== '*') readings.add(kataToHira(reading));
    }
    return [...readings];
  } catch { return []; }
}

function renderReadingChips(surface) {
  const wrap = $('modal-reading-chips');
  wrap.innerHTML = '';
  const options = dictionaryReadings(surface);
  if (!options.length) { hideAnimated(wrap); return; }
  revealAnimated(wrap);
  for (const r of options) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'reading-chip';
    chip.textContent = r;
    chip.onclick = () => {
      $('modal-reading').value = r;
      wrap.querySelectorAll('.reading-chip').forEach(c => c.classList.toggle('active', c === chip));
    };
    if (r === $('modal-reading').value) chip.classList.add('active');
    wrap.appendChild(chip);
  }
}

function modalReadingLabelFor(cat, mode) {
  if (cat === 'chinese') return { label: 'Pinyin', placeholder: 'pinyin', chips: false };
  if (cat === 'korean') {
    if (mode === 'katakana') return { label: 'Katakana', placeholder: 'カタカナ', chips: false };
    return { label: 'Romaji', placeholder: 'romaji', chips: false };
  }
  if (cat === 'japanese') {
    if (mode === 'romaji') return { label: 'Romaji', placeholder: 'romaji', chips: false };
    if (mode === 'hangul') return { label: 'Hangul', placeholder: '한글', chips: false };
    return { label: 'Reading (hiragana)', placeholder: 'ひらがな', chips: true };
  }
  return { label: 'Reading (hiragana)', placeholder: 'ひらがな', chips: true };
}

// Prefill for a fresh (not-yet-grouped) selection, in the current mode.
function autoPrefillFor(cat, mode, toks, start, end) {
  if (cat === 'japanese' && mode === 'romaji') return romajiForRange(toks, start, end);
  const range = toks.slice(start, end + 1);
  if (cat === 'japanese' && mode === 'hangul') return range.map(t => tokenHangul(t) || '').join('');
  if (cat === 'japanese') return range.map(t => t.r ? kataToHira(t.r) : '').join(''); // furigana
  if (cat === 'korean' && mode === 'katakana') return range.map(t => t.r ? hangulToKatakana(t.s) : '').join('');
  if (cat === 'chinese') return range.map(t => t.r || '').join(' ');
  return range.map(t => t.r || '').join(''); // korean romaji
}

function openSelectionModal() {
  if (performReadOnly || !selection) return;
  const cat = songCategory(currentSong);
  const mode = performReadingMode;
  const line = currentSong.lines[selection.li];
  const groups = activeGroups(currentSong, selection.li);
  const surface = line.toks.slice(selection.start, selection.end + 1).map(t => t.s).join('');
  $('modal-word').textContent = surface;
  $('modal-word').lang = langAttrFor(cat);

  const exact = groups.find(g => g.start === selection.start && g.end === selection.end);
  $('modal-reading').value = exact ? exact.reading : autoPrefillFor(cat, mode, line.toks, selection.start, selection.end);

  const info = modalReadingLabelFor(cat, mode);
  $('modal-reading-label').textContent = info.label;
  $('modal-reading').placeholder = info.placeholder;
  if (info.chips) {
    renderReadingChips(surface);
    if (!tokenizer) ensureTokenizer().then(() => renderReadingChips(surface)).catch(() => {});
  } else {
    hideAnimated($('modal-reading-chips'));
  }

  revealAnimated($('modal-backdrop'));
  $('modal-reading').focus();
}

function applyGroupEdit(li, start, end, reading) {
  const line = currentSong.lines[li];
  const key = activeGroupsKey(songCategory(currentSong), performReadingMode);
  const filtered = (line[key] || []).filter(g => g.end < start || g.start > end);
  if (reading !== null) {
    filtered.push({ start, end, reading });
    filtered.sort((a, b) => a.start - b.start);
  }
  line[key] = filtered;
  saveSongs();
}

function saveSelectionModal() {
  if (!selection) return;
  const raw = $('modal-reading').value.trim();
  const cat = songCategory(currentSong);
  const val = (cat === 'japanese' && performReadingMode === 'furigana') ? kataToHira(raw) : raw;
  applyGroupEdit(selection.li, selection.start, selection.end, val);
  closeSelectionModal();
}

function closeSelectionModal() {
  hideAnimated($('modal-backdrop'));
  selection = null;
  updateSelectionBar();
  buildLyricsDom(currentSong);
}

/* ---------------- wake lock ---------------- */

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch { /* not critical */ }
}
function releaseWakeLock() {
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !views.perform.classList.contains('hidden')) {
    requestWakeLock();
  }
});

/* ---------------- font size ---------------- */

function setFont(delta) {
  fontSize = Math.min(44, Math.max(16, fontSize + delta));
  localStorage.setItem(LS_FONT, fontSize);
  $('lyrics-container').style.fontSize = fontSize + 'px';
}

