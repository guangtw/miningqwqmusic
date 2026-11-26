import type { FriendSummary } from '@/src/types/account';
import { Equalizer } from './Equalizer';

export function FriendActivity({ presence }: { presence: FriendSummary['presence'] }) {
  if (!presence) return null;
  if (!presence.online) return <span className="friend-activity">离线</span>;
  if (!presence.listening) {
    return <span className="friend-activity online"><i className="friend-activity-dot" aria-hidden="true" />在线</span>;
  }
  return (
    <span className="friend-activity online">
      <span aria-hidden="true"><Equalizer playing /></span>
      在线听歌
    </span>
  );
}
