import fs from "fs";

const path = "src/components/player-app.tsx";
let s = fs.readFileSync(path, "utf8");
const start = s.indexOf('          {activeTab === "search" ? (');
const endMarker = '          {activeTab === "library" ? (';
const end = s.indexOf(endMarker);
if (start < 0 || end < 0 || end <= start) {
  console.error("markers not found", start, end);
  process.exit(1);
}

const replacement = `          {activeTab === "search" ? (
            <SearchPanel
              keyword={search.keyword}
              onKeywordChange={search.setKeyword}
              searchMode={search.searchMode}
              onSwitchMode={search.switchSearchMode}
              status={search.status}
              error={search.error}
              trackResult={search.trackResult}
              artistResult={search.artistResult}
              playlistResult={search.playlistResult}
              searchAssist={search.searchAssist}
              hotAssistCandidates={search.hotAssistCandidates}
              suggestAssistCandidates={search.suggestAssistCandidates}
              visibleHotAssistCount={search.visibleHotAssistCount}
              visibleSuggestAssistCount={search.visibleSuggestAssistCount}
              searchLoadingMore={search.searchLoadingMore}
              canLoadMore={search.canLoadMore}
              loadingPlaceholderCount={search.loadingPlaceholderCount}
              activeResultCount={
                search.searchMode === "artist"
                  ? search.artistResult.length
                  : search.searchMode === "playlist"
                    ? search.playlistResult.length
                    : search.trackResult.length
              }
              artistDetail={search.artistDetail}
              artistDetailLoading={search.artistDetailLoading}
              artistDetailError={search.artistDetailError}
              inputRef={search.inputRef}
              resultsBodyRef={search.resultsBodyRef}
              hotAssistRowRef={search.hotAssistRowRef}
              suggestAssistRowRef={search.suggestAssistRowRef}
              favoriteSet={favoriteSet}
              currentTrackId={currentTrackId}
              isPlaying={player.isPlaying}
              onSubmit={() => {
                void search.doSearch();
              }}
              onApplyAssistKeyword={search.applyKeywordAndSearch}
              onOpenArtist={(artist) => {
                void search.openArtistDetail(artist);
              }}
              onCloseArtistDetail={search.closeArtistDetail}
              onOpenPlaylist={openSearchPlaylist}
              onPlayTrack={(item) => {
                player.playTrackNow(item);
                player.setPlaying(true);
              }}
              onToggleFavorite={(item) => player.toggleFavorite(item)}
              onPlayArtistTopTracks={playArtistTopTracks}
              onAddArtistTopTracksToQueue={addArtistTopTracksToQueue}
            />
          ) : null}

`;

s = s.slice(0, start) + replacement + s.slice(end);
fs.writeFileSync(path, s);
console.log("replaced search JSX ok", { start, end, removed: end - start });
