import { useEffect, useRef, useState } from 'react';
import type { Playlist } from '../api';
import { libraryStore } from '../lib/account';
import { usePresence } from '../lib/motion';
import { createPlaylist, kindOf, linkPlaylist, resolvePlaylistInput, updatePlaylistInfo } from '../lib/playlists';
import { href, navigate } from '../lib/router';
import { useStore } from '../lib/store';
import { toast } from '../lib/toast';
import { uiStore, type PlaylistDialog as PlaylistDialogState } from '../player/ui';
import { Cover } from './Cover';
import { Icon } from './Icon';

/** 对话框外壳：遮罩、关闭按钮、Esc 关闭、打开时聚焦第一个输入框 */
export function Shell({ open, onClose, labelledBy, className = '', children }: { open: boolean; onClose: () => void; labelledBy: string; className?: string; children: React.ReactNode }) {
  const { mounted, state } = usePresence(open, 220);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      if (!ref.current?.contains(document.activeElement)) ref.current?.querySelector<HTMLElement>('input, textarea')?.focus();
    }, 60);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!mounted) return null;
  return (
    <>
      <div className="scrim" data-state={state} onClick={onClose} style={{ zIndex: 55 }} />
      <div ref={ref} className={`dialog ${className}`} data-state={state} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        <button className="icon-btn close" onClick={onClose} aria-label="关闭">
          <Icon name="close" />
        </button>
        {children}
      </div>
    </>
  );
}

// ---------------- 新建 / 编辑 ----------------

export function PlaylistDialog() {
  const live = useStore(uiStore, (s) => s.playlist);
  // 关闭动画期间保留最后一次的内容
  const last = useRef<PlaylistDialogState | null>(live);
  if (live) last.current = live;
  const d = last.current;
  const editing = d?.mode === 'edit' ? libraryStore.get().importedPlaylists[d.id] : undefined;
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [error, setError] = useState<string | null>(null);
  const close = () => uiStore.set({ playlist: null });

  useEffect(() => {
    if (!live) return;
    setError(null);
    setName(editing?.name ?? '');
    setDesc(editing?.description ?? '');
  }, [live]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('给歌单起个名字。');
    if (name.trim().length > 64) return setError('名字最多 64 个字。');
    if (d?.mode === 'edit') {
      updatePlaylistInfo(d.id, { name, description: desc });
      toast('歌单信息改好了。');
      close();
      return;
    }
    const tracks = d?.mode === 'create' ? d.tracks ?? [] : [];
    const pl = createPlaylist(name, desc, tracks);
    toast(tracks.length ? `新建《${pl.name}》，放进 ${pl.tracks.length} 首。` : `新建了《${pl.name}》。`);
    close();
    if (!tracks.length || (d?.mode === 'create' && d.open)) navigate(href.mine(pl.id));
  };

  const count = d?.mode === 'create' ? d.tracks?.length ?? 0 : 0;
  return (
    <Shell open={!!live} onClose={close} labelledBy="pl-title">
      <div className="kicker">{d?.mode === 'edit' ? '编辑歌单' : '新建歌单'}</div>
      <h2 id="pl-title">{d?.mode === 'edit' ? '改一改封底文字' : '压一张新唱片'}</h2>
      <p className="muted small">{count ? `会把选中的 ${count} 首放进去。` : '登录后歌单会同步到你的其他设备。'}</p>
      <form className="login-form" onSubmit={submit} noValidate>
        <label className="float">
          <input
            value={name}
            maxLength={64}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            placeholder=" "
            aria-invalid={!!error}
          />
          <span>歌单名</span>
        </label>
        <label className="float">
          <textarea value={desc} rows={3} maxLength={500} onChange={(e) => setDesc(e.target.value)} placeholder=" " />
          <span>简介（可选）</span>
        </label>
        {error && <p className="field-error">{error}</p>}
        <button className="btn solid wide">{d?.mode === 'edit' ? '保存' : count ? `新建并放进 ${count} 首` : '新建'}</button>
      </form>
    </Shell>
  );
}

// ---------------- 链接导入 ----------------

type Step = { kind: 'input' } | { kind: 'loading' } | { kind: 'preview'; playlist: Playlist; sourceUrl: string };

export function ImportDialog() {
  const open = useStore(uiStore, (s) => s.importing);
  const all = useStore(libraryStore, (s) => s.importedPlaylists);
  const [text, setText] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'input' });
  const [error, setError] = useState<string | null>(null);
  const close = () => uiStore.set({ importing: false });

  useEffect(() => {
    if (!open) return;
    setStep({ kind: 'input' });
    setError(null);
    setText('');
  }, [open]);

  const resolve = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!text.trim()) return setError('粘贴一个网易云歌单链接、分享文案或歌单 ID。');
    setError(null);
    setStep({ kind: 'loading' });
    try {
      const r = await resolvePlaylistInput(text);
      setStep({ kind: 'preview', ...r });
    } catch (err) {
      setError((err as Error).message);
      setStep({ kind: 'input' });
    }
  };

  const existing = step.kind === 'preview' ? all[step.playlist.id] : undefined;
  const linked = !!existing && kindOf(existing) === 'linked';

  const keep = () => {
    if (step.kind !== 'preview') return;
    void linkPlaylist(step.playlist, step.sourceUrl);
    toast(linked ? `《${step.playlist.name}》更新了。` : `《${step.playlist.name}》收进唱片架了。`);
    close();
    navigate(href.playlist(step.playlist.id));
  };
  const copy = () => {
    if (step.kind !== 'preview') return;
    const pl = createPlaylist(step.playlist.name, step.playlist.description, step.playlist.tracks);
    toast(`复制成了你的歌单《${pl.name}》，可以随意增删。`);
    close();
    navigate(href.mine(pl.id));
  };

  return (
    <Shell open={open} onClose={close} labelledBy="import-title" className="import-dialog">
      <div className="kicker">导入歌单</div>
      <h2 id="import-title">从网易云搬一张来</h2>
      {step.kind !== 'preview' ? (
        <>
          <p className="muted small">支持歌单链接、App 里「分享」复制出来的整段文字、163cn.tv 短链接，或纯数字歌单 ID。</p>
          <form className="login-form" onSubmit={resolve} noValidate>
            <label className="float">
              <textarea
                value={text}
                rows={4}
                onChange={(e) => {
                  setText(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && void resolve()}
                placeholder=" "
                aria-invalid={!!error}
              />
              <span>歌单链接或分享文案</span>
            </label>
            {error && <p className="field-error">{error}</p>}
            <button className="btn solid wide" disabled={step.kind === 'loading'}>
              {step.kind === 'loading' ? '正在找这张歌单…' : '识别'}
            </button>
          </form>
        </>
      ) : (
        <div className="import-preview">
          <div className="import-card">
            <Cover src={step.playlist.coverUrl} alt="" size={300} className="import-cover" />
            <div className="import-text">
              <div className="import-name">{step.playlist.name}</div>
              <div className="mono faint small">
                {step.playlist.tracks.length} 首 · 网易云歌单{linked ? ' · 已在唱片架' : ''}
              </div>
              {step.playlist.description && <p className="import-desc">{step.playlist.description}</p>}
            </div>
          </div>
          <div className="import-choices">
            <button className="import-choice primary" onClick={keep}>
              <Icon name="link" />
              <span>
                <b>{linked ? '更新这张收藏' : '收进唱片架'}</b>
                <small>跟着原歌单走，原作者更新了这里也更新</small>
              </span>
            </button>
            <button className="import-choice" onClick={copy} disabled={!step.playlist.tracks.length}>
              <Icon name="listAdd" />
              <span>
                <b>复制成我的歌单</b>
                <small>拷一份当前的 {step.playlist.tracks.length} 首，之后可以自己增删排序</small>
              </span>
            </button>
          </div>
          <button className="text-btn" onClick={() => setStep({ kind: 'input' })}>
            换一个链接
          </button>
        </div>
      )}
    </Shell>
  );
}
