import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePresence } from '../lib/motion';

const W = 232;

/**
 * 从一个按钮弹出的小菜单（和曲目菜单同一套磨砂玻璃样式）。
 * 点外面、按 Esc、换页、窗口变化时收起。
 */
export function PopMenu({
  anchor,
  open,
  onClose,
  label,
  children,
}: {
  anchor: React.RefObject<HTMLElement>;
  open: boolean;
  onClose: () => void;
  label: string;
  children: React.ReactNode;
}) {
  const { mounted, state } = usePresence(open, 200);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<React.CSSProperties>({ visibility: 'hidden' });

  useLayoutEffect(() => {
    const a = anchor.current?.getBoundingClientRect();
    if (!open || !a || !ref.current) return;
    const h = ref.current.offsetHeight;
    const vw = window.innerWidth;
    const width = Math.min(W, vw - 24);
    const left = Math.max(12, Math.min(vw - width - 12, a.left));
    const below = a.bottom + h + 18 < window.innerHeight;
    const top = below ? a.bottom + 8 : Math.max(12, a.top - h - 8);
    setPos({ left, top, width, transformOrigin: `${a.left + a.width / 2 - left}px ${below ? '0' : '100%'}` });
  }, [open, mounted, anchor]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.current?.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('hashchange', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [open, onClose, anchor]);

  if (!mounted) return null;
  return createPortal(
    <div ref={ref} className="q-panel t-menu pop-menu" role="menu" aria-label={label} data-state={state} style={pos}>
      {children}
    </div>,
    document.body,
  );
}
