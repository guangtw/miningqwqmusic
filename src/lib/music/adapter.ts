import type {
  AlbumDetail,
  ArtistSearchItem,
  ArtistDetail,
  DiscoverData,
  DownloadSource,
  PagedResult,
  Playlist,
  PlaySource,
  PlaySourceRequestOptions,
  SceneData,
  SearchAssist,
  SongInsight,
  ToplistItem,
  Track,
  TrackLyric
} from "@/src/types/music";

export type TrackSearchInput = {
  keyword: string;
  page: number;
  pageSize: number;
};

export type ArtistSearchInput = {
  keyword: string;
  page: number;
  pageSize: number;
};

export interface MusicSourceAdapter {
  searchTracks(input: TrackSearchInput): Promise<PagedResult<Track>>;
  searchArtists(input: ArtistSearchInput): Promise<PagedResult<ArtistSearchItem>>;
  getTrackDetail(trackId: string): Promise<Track>;
  getPlaySource(trackId: string, options?: PlaySourceRequestOptions): Promise<PlaySource>;
  getTrackLyric(trackId: string): Promise<TrackLyric>;
  getPlaylist(playlistId: string): Promise<Playlist>;
  getSearchAssist(keyword: string): Promise<SearchAssist>;
  getDiscoverData(): Promise<DiscoverData>;
  getToplist(): Promise<ToplistItem[]>;
  getAlbumDetail(albumId: string): Promise<AlbumDetail>;
  getArtistDetail(artistId: string): Promise<ArtistDetail>;
  getTrackInsight(trackId: string): Promise<SongInsight>;
  getDownloadSource(trackId: string, level?: string): Promise<DownloadSource>;
  getSatiScene(tag?: string): Promise<SceneData>;
  getSportScene(bpm: number): Promise<SceneData>;
}
