"use client";

import { useRef } from "react";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { canUseMagneticInteraction } from "@/src/lib/immersive-ui";

export function MagneticCard({
  className,
  ariaLabel,
  onClick,
  children,
  magnetic = true
}: {
  className?: string;
  ariaLabel: string;
  onClick: () => void;
  children: ReactNode;
  /** When false, skip tilt/magnetic tracking (used for hero stage poster). */
  magnetic?: boolean;
}) {
  const frameRef = useRef<number | null>(null);

  const reset = (element: HTMLButtonElement) => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    element.style.setProperty("--magnetic-x", "0px");
    element.style.setProperty("--magnetic-y", "0px");
    element.style.setProperty("--magnetic-glow-x", "50%");
    element.style.setProperty("--magnetic-glow-y", "50%");
    element.style.setProperty("--tilt-rotate-x", "0deg");
    element.style.setProperty("--tilt-rotate-y", "0deg");
    element.style.setProperty("--tilt-depth", "0px");
  };

  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!magnetic) {
      return;
    }

    const enabled = canUseMagneticInteraction({
      hover: window.matchMedia("(hover: hover)").matches,
      finePointer: window.matchMedia("(pointer: fine)").matches,
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches
    });
    if (!enabled) {
      reset(event.currentTarget);
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    const xRatio = rect.width ? localX / rect.width : 0.5;
    const yRatio = rect.height ? localY / rect.height : 0.5;
    const element = event.currentTarget;

    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
    }
    frameRef.current = window.requestAnimationFrame(() => {
      // Stage language: barely-there lift, no dramatic tilt
      element.style.setProperty("--magnetic-x", `${((xRatio - 0.5) * 1).toFixed(2)}px`);
      element.style.setProperty("--magnetic-y", `${((yRatio - 0.5) * 1).toFixed(2)}px`);
      element.style.setProperty("--magnetic-glow-x", `${(xRatio * 100).toFixed(1)}%`);
      element.style.setProperty("--magnetic-glow-y", `${(yRatio * 100).toFixed(1)}%`);
      element.style.setProperty("--tilt-rotate-y", `${((xRatio - 0.5) * 2).toFixed(2)}deg`);
      element.style.setProperty("--tilt-rotate-x", `${((0.5 - yRatio) * 2).toFixed(2)}deg`);
      element.style.setProperty("--tilt-depth", `${(Math.max(Math.abs(xRatio - 0.5), Math.abs(yRatio - 0.5)) * 6).toFixed(2)}px`);
      frameRef.current = null;
    });
  };

  return (
    <button
      type="button"
      className={`magnetic-card ${className ?? ""}`.trim()}
      aria-label={ariaLabel}
      style={
        {
          "--magnetic-x": "0px",
          "--magnetic-y": "0px",
          "--magnetic-glow-x": "50%",
          "--magnetic-glow-y": "50%",
          "--tilt-rotate-x": "0deg",
          "--tilt-rotate-y": "0deg",
          "--tilt-depth": "0px"
        } as CSSProperties
      }
      onPointerMove={handlePointerMove}
      onPointerLeave={(event) => reset(event.currentTarget)}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
