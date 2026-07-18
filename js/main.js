'use strict';

/* ================================================================
   Versecue — bootstrap (event wiring, init, service-worker registration) — must load last
   ================================================================ */

/* ---------------- wire up ---------------- */

$('btn-new-song').onclick = () => openEditor(null);
$('btn-editor-back').onclick = () => { renderLibrary(); showView('library'); };
$('btn-save-song').onclick = saveSong;
$('lang-btn-japanese').onclick = () => setEditorCategory('japanese');
$('lang-btn-korean').onclick = () => setEditorCategory('korean');
$('lang-btn-chinese').onclick = () => setEditorCategory('chinese');
$('lang-btn-english').onclick = () => setEditorCategory('english');
function goBackFromPerform() {
  stopYoutubePanel();
  if (performBackTo === 'sharedLibrary') { renderSharedSongList(); showView('sharedLibrary'); }
  else if (performBackTo === 'public') { showView('public'); }
  else if (performBackTo === 'otherView') { renderOtherListItems(); showView('otherView'); }
  else { renderLibrary(); showView('library'); }
}
$('btn-perform-back').onclick = goBackFromPerform;
$('btn-perform-back-2').onclick = goBackFromPerform;
$('btn-perform-add').onclick = () => {
  if ($('btn-perform-add').disabled) return;
  confirmAddToList(() => {
    addSongToMyList(currentSong, currentSong.id);
    updatePerformAddButton();
  });
};
$('btn-perform-home').onclick = () => { stopYoutubePanel(); renderLibrary(); showView('library'); };
$('btn-font-minus').onclick = () => setFont(-2);
$('btn-font-plus').onclick = () => setFont(2);
$('mode-btn-furigana').onclick = () => setPerformReadingMode('furigana');
$('mode-btn-romaji').onclick = () => setPerformReadingMode('romaji');
$('btn-sync-romaji').onclick = syncRomajiFromFurigana;
$('btn-youtube-toggle').onclick = toggleYoutubePanel;
$('youtube-load-btn').onclick = commitYoutubeLink;
$('youtube-pin-btn').onclick = toggleYoutubePin;
$('youtube-revert-btn').onclick = revertYoutubeToOriginal;
$('youtube-search-input').addEventListener('keydown', e => { if (e.key === 'Enter') commitYoutubeLink(); });
$('youtube-search-input').addEventListener('input', updateYoutubeLoadBtnState);

$('lyrics-container').addEventListener('click', onUnitClick);
$('btn-sel-cancel').onclick = clearSelection;
$('btn-sel-edit').onclick = openSelectionModal;

$('modal-cancel').onclick = closeSelectionModal;
$('modal-save').onclick = saveSelectionModal;
$('modal-backdrop').onclick = e => { if (e.target === $('modal-backdrop')) closeSelectionModal(); };
$('modal-reading').addEventListener('keydown', e => { if (e.key === 'Enter') saveSelectionModal(); });

document.querySelectorAll('.tab').forEach(btn => {
  btn.onclick = () => {
    if (btn.dataset.tab === 'library') { renderLibrary(); showView('library'); }
    else if (btn.dataset.tab === 'public') { refreshPublicView(); showView('public'); }
    else { renderOtherListItems(); showView('otherView'); }
  };
});

attachLibrarySearch();
attachPublicSearch();
attachOtherSearch();

wireLangFilter('lang-filter-library', libraryLangFilter, renderLibrary);
wireLangFilter('lang-filter-public', publicLangFilter, () => refreshPublicView());
wireLangFilter('lang-filter-shared', sharedLangFilter, renderSharedSongList);

function attachLibrarySearch() {
  attachSearchBar({
    inputId: 'library-search-input', suggestionsId: 'library-search-suggestions', btnId: 'library-search-btn', clearBtnId: 'library-search-clear',
    getSuggestions: q => filterSongsList(songs, q).slice(0, 10).map(s => ({ title: s.title, sub: s.artist || '', song: s })),
    onSuggestionClick: item => { performReadOnly = false; performBackTo = 'library'; openPerform(item.song); },
    onSearch: q => { librarySearchQuery = q.trim(); renderLibrary(); },
  });
}

$('btn-gen-code').onclick = openGenCodeModal;
$('gen-code-cancel').onclick = closeGenCodeModal;
$('gen-code-close').onclick = closeGenCodeModal;
$('gen-code-submit').onclick = submitGenCode;
$('gen-code-copy').onclick = copyGenCodeMessage;
$('gen-code-copy-code').onclick = copyGenCode;
$('gen-code-modal-backdrop').onclick = e => { if (e.target === $('gen-code-modal-backdrop')) closeGenCodeModal(); };

$('btn-add-list').onclick = () => {
  $('add-code-input').value = '';
  $('add-code-status').classList.add('hidden');
  showView('otherAdd');
};
$('btn-other-add-back').onclick = () => { renderOtherListItems(); showView('otherView'); };
$('btn-other-add-home').onclick = () => { renderLibrary(); showView('library'); };
$('btn-add-code-submit').onclick = async () => {
  const status = $('add-code-status');
  const ok = await addSharedListByCode($('add-code-input').value, status);
  if (ok) {
    status.classList.remove('hidden');
    status.textContent = 'Added! ✓';
    otherSearchPool = null;
    renderOtherListItems();
    setTimeout(() => showView('otherView'), 500);
  }
};
$('btn-shared-lib-back').onclick = () => { renderOtherListItems(); showView('otherView'); };
$('btn-shared-lib-home').onclick = () => { renderLibrary(); showView('library'); };

$('remove-other-cancel').onclick = () => { removeOtherCode = null; hideAnimated($('remove-other-backdrop')); };
$('remove-other-confirm').onclick = doRemoveOther;

$('publish-confirm-cancel').onclick = () => { pendingPublishSong = null; hideAnimated($('publish-confirm-backdrop')); };
$('publish-confirm-confirm').onclick = doPublish;
$('remove-song-cancel').onclick = () => { removeSongId = null; hideAnimated($('remove-song-backdrop')); };
$('remove-song-confirm').onclick = doRemoveSong;
$('add-confirm-cancel').onclick = () => { pendingAddToList = null; hideAnimated($('add-confirm-backdrop')); };
$('add-confirm-confirm').onclick = doAddToList;

/* ---------------- init ---------------- */

async function initSongs() {
  songs = loadSongs();
  for (const s of songs) migrateSong(s);
  renderLibrary();

  const joinCode = new URLSearchParams(location.search).get('join');
  if (joinCode) {
    history.replaceState(null, '', location.pathname);
    const added = await addSharedListByCode(joinCode);
    if (added) { renderOtherListItems(); showView('otherView'); }
    else alert('That sharing code was not found — ask your friend to check it.');
  }
}

showView('library');
initSongs();

/* ---------------- service worker ---------------- */

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
