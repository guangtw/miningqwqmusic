import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { toastStore } from '../lib/toast';

/** 提示条：新消息从下方弹上来，消失时淡出下沉 */
export function Toast() {
  const message = useStore(toastStore, (s) => s.message);
  const key = useStore(toastStore, (s) => s.key);
  const [shown, setShown] = useState<{ text: string; key: number; leaving: boolean } | null>(null);

  useEffect(() => {
    if (message) {
      setShown({ text: message, key, leaving: false });
      return;
    }
    setShown((s) => (s ? { ...s, leaving: true } : s));
    const t = setTimeout(() => setShown(null), 240);
    return () => clearTimeout(t);
  }, [message, key]);

  if (!shown) return null;
  return (
    <div className="toast" key={shown.key} data-state={shown.leaving ? 'closing' : 'open'} role="status">
      {shown.text}
    </div>
  );
}
