import { forwardRef, useMemo, useState } from 'react';
import { image } from '../config/site';

/** 网易云图床支持 ?param=WxH 缩略；可在配置里关掉 */
export function sized(url: string | undefined, px: number) {
  if (!url || !image.resizeParam || url.startsWith('data:') || url.includes('param=') || !/music\.126\.net/.test(url))
    return url;
  return `${url}${url.includes('?') ? '&' : '?'}param=${px}y${px}`;
}

/** 同一张图的身份：网易云图床会随机分到 p1~p4 等不同域名，去掉域名分片和查询参数再比 */
export function imageKey(url: string) {
  return url.replace(/^https?:\/\/p\d+\.music\.126\.net/, '126:').split('?')[0];
}

// 加载过的图：再次出现时直接显示，不再淡入；
// 同一张封面换了尺寸（卡片 300 → 详情 600）时，先垫上已有的小图，大图到了再盖上去。
const loadedUrls = new Set<string>();
const largest = new Map<string, { url: string; px: number }>();

function remember(src: string, url: string, px: number) {
  loadedUrls.add(url);
  const key = imageKey(src);
  const prev = largest.get(key);
  if (!prev || px > prev.px) largest.set(key, { url, px });
}

interface Props {
  src?: string;
  alt: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

type LoadState = 'loading' | 'ready' | 'failed';

/** 封面：图片加载完淡入，失败或没有图时画一张空唱片 */
export const Cover = forwardRef<HTMLDivElement, Props>(function Cover({ src, alt, size = 300, className = '', style }, ref) {
  const url = sized(src, size);
  // 换图时判断一次：是否已在缓存里、有没有可以垫底的小图
  const { cached, low } = useMemo(() => {
    const hit = !!url && loadedUrls.has(url);
    return { cached: hit, low: src && !hit ? largest.get(imageKey(src))?.url : undefined };
  }, [src, url]);
  const [loadState, setLoadState] = useState<{ url?: string; state: LoadState }>({ url, state: 'loading' });
  const state: LoadState = loadState.url === url ? loadState.state : 'loading';
  const shown: LoadState = cached && state === 'loading' ? 'ready' : state;
  const missing = !url || shown === 'failed';

  const ready = () => {
    if (src && url) remember(src, url, size);
    setLoadState({ url, state: 'ready' });
  };

  return (
    <div
      ref={ref}
      className={`cover ${missing ? 'missing' : ''} ${shown === 'ready' ? 'ready' : ''} ${cached ? 'instant' : ''} ${className}`}
      style={style}
    >
      {low && !missing && <img className="cover-low" src={low} alt="" decoding="sync" />}
      {url && shown !== 'failed' && (
        <img
          key={url}
          src={url}
          alt={alt}
          // 缓存里已有的图同步解码，视图过渡拍快照时就已经画好了
          loading={cached ? 'eager' : 'lazy'}
          decoding={cached ? 'sync' : 'async'}
          onLoad={ready}
          onError={() => setLoadState({ url, state: 'failed' })}
          ref={(img) => {
            // 缓存命中时 onLoad 可能早于挂载
            if (img?.complete && img.naturalWidth && state === 'loading') ready();
          }}
        />
      )}
    </div>
  );
});
