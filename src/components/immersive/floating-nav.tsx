"use client";

import type { ReactNode } from "react";
import { IMMERSIVE_NAV_ITEMS, type ImmersiveDestination } from "@/src/lib/immersive-ui";

type PrimaryTab = Exclude<ImmersiveDestination, "listen">;

export type FloatingNavProps = {
  active: PrimaryTab | null;
  onSelect: (destination: ImmersiveDestination) => void;
  onProfile: () => void;
  onSettings: () => void;
};

function NavGlyph({ id }: { id: ImmersiveDestination | "profile" | "settings" }) {
  const common = {
    width: 21,
    height: 21,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true
  };

  const paths: Record<typeof id, ReactNode> = {
    home: (
      <>
        <path d="m3.5 10.5 8.5-7 8.5 7" />
        <path d="M5.5 9.2V21h13V9.2M9.5 21v-6h5v6" />
      </>
    ),
    search: (
      <>
        <circle cx="10.7" cy="10.7" r="6.7" />
        <path d="m16 16 4.5 4.5" />
      </>
    ),
    library: (
      <>
        <path d="M4 4.5v15M9 4.5v15M14 6l2.8-1.5 3.2 14.8-3 .7z" />
      </>
    ),
    listen: (
      <>
        <path d="M8.5 12.5a4 4 0 1 0-3 0A6 6 0 0 0 2 18v1.5h10V18a6 6 0 0 0-3.5-5.5Z" />
        <path d="M15 7.5a3 3 0 1 1 0 5.7M15.5 15.5c3.5.2 5.5 1.6 5.5 4" />
      </>
    ),
    profile: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 8.97 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15 1.7 1.7 0 0 0 3.08 14H3v-4h.08A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.97 4.6 1.7 1.7 0 0 0 10 3.08V3h4v.08A1.7 1.7 0 0 0 15.03 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9 1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z" />
      </>
    )
  };

  return <svg {...common}>{paths[id]}</svg>;
}

function FloatingNavButton({
  label,
  active,
  onClick,
  children
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`floating-nav-button ${active ? "active" : ""}`.trim()}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      data-tooltip={label}
      onClick={onClick}
    >
      <span className="floating-nav-indicator" aria-hidden="true" />
      {children}
    </button>
  );
}

export function FloatingNav({ active, onSelect, onProfile, onSettings }: FloatingNavProps) {
  return (
    <nav className="floating-nav" aria-label="主导航">
      <div className="floating-nav-primary">
        {IMMERSIVE_NAV_ITEMS.map((item) => (
          <FloatingNavButton
            key={item.id}
            label={item.label}
            active={item.id !== "listen" && item.id === active}
            onClick={() => onSelect(item.id)}
          >
            <NavGlyph id={item.id} />
          </FloatingNavButton>
        ))}
      </div>
      <div className="floating-nav-utilities">
        <FloatingNavButton label="个人中心" onClick={onProfile}>
          <NavGlyph id="profile" />
        </FloatingNavButton>
        <FloatingNavButton label="设置" onClick={onSettings}>
          <NavGlyph id="settings" />
        </FloatingNavButton>
      </div>
    </nav>
  );
}
