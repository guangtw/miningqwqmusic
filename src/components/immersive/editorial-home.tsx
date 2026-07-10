"use client";

import type { CSSProperties } from "react";
import { MagneticCard } from "@/src/components/immersive/magnetic-card";
import { breakDisplayTitle } from "@/src/lib/title-line-break";

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

function HeroTitle({ title }: { title: string }) {
  const lines = breakDisplayTitle(title, {
    maxLines: 2,
    targetCharsPerLine: 10,
    maxCharsPerLine: 12
  });

  if (!lines.length) return null;

  return (
    <h1 className="editorial-hero-title" aria-label={title}>
      {lines.map((line, index) => (
        <span key={`${index}-${line}`} className="editorial-hero-title-line">
          {line}
        </span>
      ))}
    </h1>
  );
}

function heroMediaStyle(url?: string): CSSProperties {
  const cover = url || "/assets/default-cover.svg";
  return {
    backgroundImage: `
      linear-gradient(105deg, rgba(7, 10, 12, 0.94) 0%, rgba(7, 10, 12, 0.78) 38%, rgba(7, 10, 12, 0.42) 62%, rgba(7, 10, 12, 0.18) 100%),
      radial-gradient(circle at 78% 42%, rgba(34, 211, 94, 0.14), transparent 42%),
      url(${cover})
    `,
    backgroundSize: "auto, auto, cover",
    backgroundPosition: "center, center, center right",
    backgroundRepeat: "no-repeat"
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
  onMore,
  variant = "featured"
}: {
  title: string;
  items: T[];
  onSelect: (item: T) => void;
  onMore?: () => void;
  variant?: "featured" | "explore";
}) {
  if (!items.length) return null;

  return (
    <section className={`editorial-rail editorial-rail--${variant}`}>
      <header className="editorial-rail-head">
        <h2>{title}</h2>
        {onMore ? (
          <button type="button" onClick={onMore}>
            查看更多
            <span aria-hidden="true">↗</span>
          </button>
        ) : null}
      </header>
      <div className={`editorial-rail-track editorial-rail-track--${variant}`}>
        {items.map((item, index) => (
          <MagneticCard
            key={`${title}-${item.id}-${index}`}
            className="editorial-cover-card"
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
          magnetic={false}
        >
          <span className="editorial-hero-media" style={heroMediaStyle(hero.coverUrl)} />
          <span className="editorial-hero-noise" aria-hidden="true" />
          <span className="editorial-hero-copy">
            <span className="editorial-hero-badge">STAGE · 精选</span>
            <HeroTitle title={hero.title} />
            <p>{hero.subtitle || "让声音接管此刻，把今天留在音乐里。"}</p>
            <span className="editorial-hero-action">
              <span className="editorial-play-glyph" aria-hidden="true">
                ▶
              </span>
              播放精选
            </span>
          </span>
          <span className="editorial-hero-visual" aria-hidden="true">
            <span className="editorial-hero-visual-glow" />
            <span className="editorial-hero-card editorial-hero-card-main" style={posterStyle(hero.coverUrl)} />
          </span>
        </MagneticCard>
      ) : (
        <section className="editorial-empty">
          <div className="editorial-empty-copy">
            <span className="editorial-hero-badge">STAGE · 发现</span>
            <h1>发现</h1>
            <p>推荐内容正在路上，也可以先从搜索开始。</p>
            {onExplore ? (
              <button type="button" onClick={onExplore}>
                搜索音乐
              </button>
            ) : null}
          </div>
        </section>
      )}

      <EditorialRail title="为你精选" items={featured} onSelect={onSelect} onMore={onMore} variant="featured" />
      <EditorialRail title="继续探索" items={recent} onSelect={onSelect} variant="explore" />
      {error ? <p className="error error-inline">{error}</p> : null}
    </div>
  );
}
