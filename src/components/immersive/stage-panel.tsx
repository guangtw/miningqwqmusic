"use client";

import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  stageNavItemVariants,
  stageSectionVariants,
  stageViewVariants,
  withReducedMotion
} from "@/src/lib/motion-presets";

export type StagePanelNavItem = {
  id: string;
  label: string;
  count?: number;
  disabled?: boolean;
};

export type StagePanelShellProps = {
  title: string;
  kicker?: string;
  description?: string;
  status?: ReactNode;
  onClose: () => void;
  nav: StagePanelNavItem[];
  activeNav: string;
  onNav: (id: string) => void;
  navAriaLabel: string;
  children: ReactNode;
  /** Bumps enter animation when the active section changes. */
  stageKey: string;
  className?: string;
  footer?: ReactNode;
};

/**
 * Shared chrome for secondary surfaces (一起听 / 设置 / 账户).
 * Content swaps use Motion AnimatePresence + spring/easeOutExpo presets.
 * @see https://github.com/motiondivision/motion
 */
export function StagePanelShell({
  title,
  kicker,
  description,
  status,
  onClose,
  nav,
  activeNav,
  onNav,
  navAriaLabel,
  children,
  stageKey,
  className,
  footer
}: StagePanelShellProps) {
  const reducedMotion = useReducedMotion();
  const viewVariants = withReducedMotion(stageViewVariants, reducedMotion);
  const navVariants = withReducedMotion(stageNavItemVariants, reducedMotion);

  return (
    <div className={`stage-panel ${className ?? ""}`.trim()}>
      <header className="stage-panel-chrome">
        <div className="stage-panel-chrome-main">
          {kicker ? <span className="stage-panel-kicker">{kicker}</span> : null}
          <div className="stage-panel-title-row">
            <h3>{title}</h3>
            {status ? <div className="stage-panel-status">{status}</div> : null}
          </div>
          {description ? <p className="stage-panel-desc">{description}</p> : null}
        </div>
        <button type="button" className="stage-panel-close ghost" onClick={onClose}>
          关闭
        </button>
      </header>

      <div className="stage-panel-body">
        <nav className="stage-panel-nav" role="tablist" aria-label={navAriaLabel}>
          {nav.map((item, index) => (
            <motion.button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={activeNav === item.id}
              disabled={item.disabled}
              className={`stage-panel-nav-item ${activeNav === item.id ? "active" : ""}`.trim()}
              custom={index}
              variants={navVariants}
              initial="hidden"
              animate="visible"
              onClick={() => onNav(item.id)}
            >
              <span className="stage-panel-nav-label">{item.label}</span>
              {typeof item.count === "number" && item.count > 0 ? (
                <span className="stage-panel-nav-count">{item.count}</span>
              ) : null}
              <span className="stage-panel-nav-indicator" aria-hidden="true" />
            </motion.button>
          ))}
        </nav>

        <div className="stage-panel-stage">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={stageKey}
              className="stage-panel-view"
              data-stage-key={stageKey}
              variants={viewVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {footer ? <footer className="stage-panel-footer">{footer}</footer> : null}
    </div>
  );
}

export type StageSectionProps = {
  title: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Stagger index for enter animation */
  index?: number;
};

export function StageSection({ title, hint, action, children, className, index = 0 }: StageSectionProps) {
  const reducedMotion = useReducedMotion();
  const variants = withReducedMotion(stageSectionVariants, reducedMotion);

  return (
    <motion.section
      className={`stage-section ${className ?? ""}`.trim()}
      custom={index}
      variants={variants}
      initial="hidden"
      animate="visible"
    >
      <header className="stage-section-head">
        <div className="stage-section-copy">
          <h4>{title}</h4>
          {hint ? <p>{hint}</p> : null}
        </div>
        {action ? <div className="stage-section-action">{action}</div> : null}
      </header>
      <div className="stage-section-body">{children}</div>
    </motion.section>
  );
}

export type StageEmptyProps = {
  title: string;
  description?: string;
  action?: ReactNode;
};

export function StageEmpty({ title, description, action }: StageEmptyProps) {
  return (
    <div className="stage-empty">
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
      {action ? <div className="stage-empty-action">{action}</div> : null}
    </div>
  );
}
