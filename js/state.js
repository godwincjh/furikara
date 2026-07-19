'use strict';

/* ================================================================
   Versecue — state & local storage (foundation: constants, LS helpers, global mutable state)
   ================================================================ */

/* ---------------- storage ---------------- */

const LS_SONGS = 'versecue.songs';
const LS_FONT = 'versecue.fontSize';
const LS_MY_SHARES = 'versecue.myShares';       // codes I generated, to keep pushing updates to
const LS_OTHER_LISTS = 'versecue.otherLists';   // lists others shared with me
const API_ORIGIN = 'https://versecue-share.pages.dev';

const APP_SHARE_URL = 'https://versecue.net/';
const APP_SHARE_TEXT = '🎤 Sing karaoke in any language with Versecue — it prints the reading (furigana, romaji, Hangul, pinyin) above every lyric so you can sing along, even offline. Try it free:';

function loadSongs() {
  try { return JSON.parse(localStorage.getItem(LS_SONGS)) || []; }
  catch { return []; }
}
function persistLocal() {
  localStorage.setItem(LS_SONGS, JSON.stringify(songs));
}
function myShares() {
  try { return JSON.parse(localStorage.getItem(LS_MY_SHARES)) || []; }
  catch { return []; }
}
function saveMyShares(list) {
  localStorage.setItem(LS_MY_SHARES, JSON.stringify(list));
}
function otherLists() {
  try { return JSON.parse(localStorage.getItem(LS_OTHER_LISTS)) || []; }
  catch { return []; }
}
function saveOtherLists(list) {
  localStorage.setItem(LS_OTHER_LISTS, JSON.stringify(list));
}
function saveSongs() {
  persistLocal();
  pushMyShares();
}
async function pushMyShares() {
  for (const share of myShares()) {
    try {
      await fetch(`${API_ORIGIN}/api/list/${encodeURIComponent(share.code)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songs, listName: share.listName, userName: share.userName }),
      });
    } catch { /* offline — will retry on next save */ }
  }
}

/* ---------------- state ---------------- */

let songs = [];
let currentSong = null;      // song object being performed
let editingSongId = null;    // song id being edited in editor, null = new
let fontSize = parseInt(localStorage.getItem(LS_FONT), 10) || 26;
let tokenizer = null;
let tokenizerPromise = null;
let wakeLock = null;
let selection = null;        // { li, anchorStart, anchorEnd, start, end }
let performReadOnly = false; // true while viewing a song from someone else's shared list
let performBackTo = null;    // view name to return to from perform
let sharedLibCode = null;    // code of the shared list currently open in view-shared-library
let sharedLibSongs = null;   // songs array fetched for that shared list
const sharedLangFilter = { japanese: true, korean: true, chinese: true, english: true };
let removeOtherCode = null;  // code pending removal confirmation
let pendingPublishSong = null; // song pending publish confirmation
let removeSongId = null;     // My List song id pending removal confirmation
let pendingAddToList = null; // callback pending add-to-list confirmation

