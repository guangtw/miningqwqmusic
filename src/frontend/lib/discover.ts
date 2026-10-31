import { hasId, type DiscoverItem } from '../api';
import { href } from './router';

export type DiscoverAction =
  | { kind: 'link'; to: string; heroKey: string }
  | { kind: 'external'; url: string }
  | { kind: 'play'; trackId: string }
  | { kind: 'none' };

/** 只有网页链接能在浏览器里打开；orpheus:// 之类是网易云 App 内部链接 */
const isWebUrl = (url?: string) => !!url && /^https?:\/\//i.test(url);

/** 推荐条目点开后去哪，与原项目 discover-action.ts 的语义一致 */
export function resolveDiscover(item: DiscoverItem): DiscoverAction {
  const id = item.targetId;
  if (item.type === 'banner') return isWebUrl(item.linkUrl) ? { kind: 'external', url: item.linkUrl! } : { kind: 'none' };
  if (!hasId(id)) return isWebUrl(item.linkUrl) ? { kind: 'external', url: item.linkUrl! } : { kind: 'none' };
  switch (item.type) {
    case 'track':
    case 'scene':
      return { kind: 'play', trackId: id };
    case 'playlist':
      return { kind: 'link', to: href.playlist(id), heroKey: `playlist:${id}` };
    case 'toplist':
      return { kind: 'link', to: href.toplist(id), heroKey: `toplist:${id}` };
    case 'album':
      return { kind: 'link', to: href.album(id), heroKey: `album:${id}` };
    case 'artist':
      return { kind: 'link', to: href.artist(id), heroKey: `artist:${id}` };
    default:
      return { kind: 'none' };
  }
}
