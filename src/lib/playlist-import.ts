const PLAYLIST_ID_PATTERNS: RegExp[] = [
  /#\/playlist\?id=(\d{5,})/i,
  /playlist\?id=(\d{5,})/i,
  /\/playlist\/(\d{5,})/i,
  /playlist[^0-9]{0,12}(\d{5,})/i,
  /歌单[^0-9]{0,12}(\d{5,})/i,
  /\b(\d{8,})\b/
];

const HTTP_URL_PATTERN = /https?:\/\/[^\s]+/i;

export function extractPlaylistId(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  for (const pattern of PLAYLIST_ID_PATTERNS) {
    const matched = pattern.exec(text);
    if (matched?.[1]) return matched[1];
  }
  return null;
}

export function extractFirstHttpUrl(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const matched = HTTP_URL_PATTERN.exec(text);
  if (!matched?.[0]) return null;
  return matched[0].replace(/[),.;!?。！，；、）]+$/u, "");
}
