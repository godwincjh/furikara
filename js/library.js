'use strict';

/* ================================================================
   Versecue — My List (library render, publish / remove / add-to-list flows)
   ================================================================ */

/* ---------------- library (My List) ---------------- */

function filterSongsList(list, query) {
  if (!query.trim()) return [];
  return list.filter(s => matchesQuery(query, s));
}

let librarySearchQuery = '';
const libraryLangFilter = { japanese: true, korean: true, chinese: true, english: true };

let libraryPage = 0;

function renderLibrary() { libraryPage = 0; renderLibraryPage(); }  // external entry: back to page 1

function renderLibraryPage() {
  const base = librarySearchQuery ? filterSongsList(songs, librarySearchQuery) : songs;
  const list = base.filter(s => passesLangFilter(songCategory(s), libraryLangFilter));
  const wrap = $('song-list');
  wrap.innerHTML = '';
  if (!list.length) {
    const d = document.createElement('div');
    d.className = 'empty-library';
    d.textContent = librarySearchQuery
      ? 'No songs match that search.'
      : songs.length
      ? 'No songs match this filter.'
      : 'No songs yet.\nAdd one, paste the lyrics, and the guiding words appear automatically — fully offline. ♪';
    wrap.appendChild(d);
    return;
  }
  libraryPage = Math.min(libraryPage, pageCount(list.length) - 1);
  for (const song of pageSlice(list, libraryPage)) {
    const card = document.createElement('div');
    card.className = 'song-card';

    const main = document.createElement('div');
    main.className = 'song-card-main';
    const t = document.createElement('div');
    t.className = 'song-card-title';
    t.lang = langAttrFor(songCategory(song));
    t.textContent = song.title || '(untitled)';
    const sub = document.createElement('div');
    sub.className = 'song-card-sub';
    sub.textContent = song.artist || '';
    main.append(t, sub, buildSongCardTags(songCategory(song), !!song.youtubeId));
    main.onclick = () => { performReadOnly = false; performBackTo = 'library'; openPerform(song); };

    const bPublish = document.createElement('button');
    const alreadyPublished = !!song.publishId;
    const cantPublish = alreadyPublished || song.imported;
    bPublish.className = 'song-card-btn' + (alreadyPublished ? ' published' : '');
    bPublish.textContent = '🌐';
    bPublish.disabled = cantPublish;
    bPublish.title = alreadyPublished ? 'Already published'
      : song.imported ? 'Songs added from Public List/Shared Lists can\'t be republished'
      : 'Publish to Public List';
    bPublish.onclick = e => { e.stopPropagation(); if (!cantPublish) confirmPublish(song); };

    const bEdit = document.createElement('button');
    bEdit.className = 'song-card-btn';
    bEdit.textContent = '✎';
    bEdit.onclick = e => { e.stopPropagation(); openEditor(song); };

    const bDel = document.createElement('button');
    bDel.className = 'song-card-btn';
    bDel.textContent = '🗑';
    bDel.onclick = e => { e.stopPropagation(); confirmRemoveSong(song.id); };

    card.append(main, bPublish, bEdit, bDel);
    wrap.appendChild(card);
  }
  appendPagination(wrap, list.length, libraryPage, p => { libraryPage = p; renderLibraryPage(); wrap.scrollTop = 0; });
}

function confirmPublish(song) {
  pendingPublishSong = song;
  revealAnimated($('publish-confirm-backdrop'));
}

function doPublish() {
  if (!pendingPublishSong) return;
  hideAnimated($('publish-confirm-backdrop'));
  publishSong(pendingPublishSong);
  pendingPublishSong = null;
}

function confirmRemoveSong(id) {
  removeSongId = id;
  revealAnimated($('remove-song-backdrop'));
}

function doRemoveSong() {
  if (!removeSongId) return;
  songs = songs.filter(s => s.id !== removeSongId);
  saveSongs();
  removeSongId = null;
  hideAnimated($('remove-song-backdrop'));
  renderLibrary();
}

function confirmAddToList(execute) {
  pendingAddToList = execute;
  revealAnimated($('add-confirm-backdrop'));
}

function doAddToList() {
  if (!pendingAddToList) return;
  const execute = pendingAddToList;
  pendingAddToList = null;
  hideAnimated($('add-confirm-backdrop'));
  execute();
}

async function publishSong(song) {
  if (song.publishId || song.imported) return; // button is disabled for these, but guard anyway
  try {
    const res = await fetch(`${API_ORIGIN}/api/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: song.title, artist: song.artist, category: songCategory(song), originalYoutubeId: song.originalYoutubeId || null, rawLyrics: song.rawLyrics, lines: song.lines }),
    });
    if (!res.ok) throw new Error('fail');
    const data = await res.json();
    song.publishId = data.id;
    persistLocal();
    showToast('Published to Public List!');
    renderLibrary();
  } catch {
    showToast('Could not publish — check your connection.');
  }
}

function addSongToMyList(song, sourceId) {
  const clone = JSON.parse(JSON.stringify(song));
  clone.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  delete clone.publishId;
  clone.imported = true;
  if (sourceId) clone.importedFrom = sourceId;
  // Public List records only ever carry originalYoutubeId (no personal override
  // field exists there); Other-Lists songs carry both, reflecting whatever the
  // sharer currently has set. Either way, your own copy starts with a current
  // youtubeId so it's immediately playable, and can be overridden independently.
  clone.youtubeId = clone.youtubeId || clone.originalYoutubeId || null;
  songs.unshift(clone);
  saveSongs();
  showToast('Song added to My List');
}

