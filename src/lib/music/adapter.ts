import type { PagedResult, Playlist, PlaySource, Track, TrackLyric } from "@/src/types/music";

export type TrackSearchInput = {
  keyword: string;
  page: number;
  pageSize: number;
};

export interface MusicSourceAdapter {
  searchTracks(input: TrackSearchInput): Promise<PagedResult<Track>>;
  getTrackDetail(trackId: string): Promise<Track>;
  getPlaySource(trackId: string): Promise<PlaySource>;
  getTrackLyric(trackId: string): Promise<TrackLyric>;
  getPlaylist(playlistId: string): Promise<Playlist>;
}
