"use client";

import type { CSSProperties } from "react";
import { MagneticCard } from "@/src/components/immersive/magnetic-card";

export type EditorialItem = {
  id: string;
  title: string;
  subtitle?: string;
  coverUrl?: string;
};

export type EditorialHomeProps<T extends EditorialItem> = {
  hero?: T;
  featured: T[];
  recent: T[];
  onSelect: (item: T) => void;
  onMore: () => void;
  onExplore?: () => void;
  error?: string | null;
};

function coverStyle(url?: string): CSSProperties {
  return {
    backgroundImage: `radial-gradient(circle at 76% 22%, rgba(126, 117, 219, 0.18), transparent 24%), linear-gradient(90deg, rgba(4, 6, 10, 0.985) 0%, rgba(7, 9, 14, 0.94) 34%, rgba(8, 10, 16, 0.76) 58%, rgba(8, 10, 16, 0.42) 74%, rgba(8, 10, 16, 0.18) 100%), url(${url || "/assets/default-cover.svg"})`,
    backgroundSize: "auto, auto, min(72%, 980px) auto",
    backgroundPosition: "center, center, calc(100% + 64px) center",
    backgroundRepeat: "no-repeat, no-repeat, no-repeat"
  };
}

function posterStyle(url?: string): CSSProperties {
  return {
    backgroundImage: `url(${url || "/assets/default-cover.svg"})`
  };
}

function EditorialRail<T extends EditorialItem>({
  title,
  items,
  onSelect,
  onMore
}: {
  title: string;
  items: T[];
  onSelect: (item: T) => void;
  onMore?: () => void;
}) {
  if (!items.length) return null;

  return (
    <section className="editorial-rail">
      <header className="editorial-rail-head">
        <h2>{title}</h2>
        {onMore ? (
          <button type="button" onClick={onMore}>
            查看更多
            <span aria-hidden="true">↗</span>
          </button>
        ) : null}
      </header>
      <div className="editorial-rail-track">
        {items.map((item, index) => (
          <MagneticCard
            key={`${title}-${item.id}-${index}`}
            className="editorial-cover-card comet-card"
            ariaLabel={`打开：${item.title}`}
            onClick={() => onSelect(item)}
          >
            <span className="editorial-cover-art" style={{ backgroundImage: `url(${item.coverUrl || "/assets/default-cover.svg"})` }} />
            <span className="editorial-cover-copy">
              <strong>{item.title}</strong>
              <small>{item.subtitle || "为你精选"}</small>
            </span>
          </MagneticCard>
        ))}
      </div>
    </section>
  );
}

export function EditorialHome<T extends EditorialItem>({
  hero,
  featured,
  recent,
  onSelect,
  onMore,
  onExplore,
  error
}: EditorialHomeProps<T>) {
  return (
    <div className="editorial-home">
      {hero ? (
        <MagneticCard
          className="editorial-hero"
          ariaLabel={`播放精选：${hero.title}`}
          onClick={() => onSelect(hero)}
        >
          <span className="editorial-hero-media" style={coverStyle(hero.coverUrl)} />
          <span className="editorial-hero-noise" aria-hidden="true" />
          <span className="editorial-hero-copy">
            <h1>{hero.title}</h1>
            <p>{hero.subtitle || "让声音接管此刻，把今天留在音乐里。"}</p>
            <span className="editorial-hero-action">
              <span className="editorial-play-glyph" aria-hidden="true">▶</span>
              播放精选
            </span>
          </span>
          <span className="editorial-hero-visual" aria-hidden="true">
            <span className="editorial-hero-visual-glow" />
            <span className="editorial-hero-card editorial-hero-card-back-left" style={posterStyle(hero.coverUrl)} />
            <span className="editorial-hero-card editorial-hero-card-back-right" style={posterStyle(hero.coverUrl)} />
            <span className="editorial-hero-card editorial-hero-card-main" style={posterStyle(hero.coverUrl)} />
          </span>
        </MagneticCard>
      ) : (
        <section className="editorial-empty">
          <div className="editorial-empty-copy">
            <h1>发现</h1>
            <p>推荐内容正在路上，也可以先从搜索开始。</p>
            {onExplore ? (
              <button type="button" onClick={onExplore}>搜索音乐</button>
            ) : null}
          </div>
          <div className="editorial-empty-visual" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </section>
      )}

      <EditorialRail title="为你精选" items={featured} onSelect={onSelect} onMore={onMore} />
      <EditorialRail title="继续探索" items={recent} onSelect={onSelect} />
      {error ? <p className="error error-inline">{error}</p> : null}
    </div>
  );
}
