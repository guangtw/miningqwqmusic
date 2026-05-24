const PLAYLIST_ID_PATTERNS: RegExp[] = [
  /#\/playlist\?id=(\d{5,})/i,
  /playlist\?id=(\d{5,})/i,
  /\/playlist\/(\d{5,})/i,
  /playlist[^0-9]{0,12}(\d{5,})/i,
  /歌单[^0-9]{0,12}(\d{5,})/i,
  /\b(\d{8,})\b/
];

export function extractPlaylistId(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  for (const pattern of PLAYLIST_ID_PATTERNS) {
    const matched = pattern.exec(text);
    if (matched?.[1]) return matched[1];
  }
  return null;
}
