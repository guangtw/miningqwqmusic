/**
 * Shared motion presets for Echo Stage.
 *
 * Sources / conventions:
 * - Motion (ex Framer Motion) spring recipes — https://github.com/motiondivision/motion
 * - GPU-safe properties only: opacity + transform (no layout thrash)
 * - Expo / quart ease curves common in production UI kits
 * - Respect prefers-reduced-motion at call sites via `useReducedMotion`
 */

import type { Transition, Variants } from "motion/react";

/** Smooth ease-out expo — polished panel / sheet enter */
export const easeOutExpo: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** Soft ease-out cubic — content fades */
export const easeOutSoft: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** Snappy UI spring (tabs, chips, micro-interactions) */
export const springSnappy: Transition = {
  type: "spring",
  stiffness: 520,
  damping: 38,
  mass: 0.7
};

/** Soft spring for panels / cards */
export const springSoft: Transition = {
  type: "spring",
  stiffness: 320,
  damping: 32,
  mass: 0.85
};

/** Gentle spring for staggered list items */
export const springStagger: Transition = {
  type: "spring",
  stiffness: 380,
  damping: 30,
  mass: 0.75
};

export const tweenSoft: Transition = {
  duration: 0.36,
  ease: easeOutExpo
};

export const tweenQuick: Transition = {
  duration: 0.22,
  ease: easeOutSoft
};

/** Overlay dim — opacity only */
export const overlayVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.28, ease: easeOutSoft }
  },
  exit: {
    opacity: 0,
    transition: { duration: 0.18, ease: "easeIn" }
  }
};

/** Modal / auth sheet — rise + fade (desktop) */
export const sheetVariants: Variants = {
  hidden: { opacity: 0, y: 18, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: springSoft
  },
  exit: {
    opacity: 0,
    y: 10,
    scale: 0.985,
    transition: tweenQuick
  }
};

/** Mobile bottom sheet */
export const sheetMobileVariants: Variants = {
  hidden: { opacity: 0, y: 40 },
  visible: {
    opacity: 1,
    y: 0,
    transition: springSoft
  },
  exit: {
    opacity: 0,
    y: 24,
    transition: tweenQuick
  }
};

/** Stage panel content swap */
export const stageViewVariants: Variants = {
  hidden: { opacity: 0, x: 14 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.34, ease: easeOutExpo }
  },
  exit: {
    opacity: 0,
    x: -10,
    transition: { duration: 0.18, ease: "easeIn" }
  }
};

export const stageViewMobileVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.34, ease: easeOutExpo }
  },
  exit: {
    opacity: 0,
    y: 8,
    transition: { duration: 0.16, ease: "easeIn" }
  }
};

/** Staggered section cards inside a stage view */
export const stageSectionVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: (index = 0) => ({
    opacity: 1,
    y: 0,
    transition: {
      ...springStagger,
      delay: Math.min(index * 0.05, 0.2)
    }
  })
};

/** Side nav items */
export const stageNavItemVariants: Variants = {
  hidden: { opacity: 0, x: -8 },
  visible: (index = 0) => ({
    opacity: 1,
    x: 0,
    transition: {
      duration: 0.28,
      ease: easeOutSoft,
      delay: Math.min(index * 0.04, 0.16)
    }
  })
};

/** Form field group fade when login/register toggles (content only) */
export const fieldsSwapVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.22, ease: easeOutSoft }
  },
  exit: {
    opacity: 0,
    transition: { duration: 0.14, ease: "easeIn" }
  }
};

/**
 * Panel size change when extra fields mount/unmount (login ↔ register).
 * Prefer smooth expo tween over spring — springs overshoot and feel "顿挫" on height.
 */
export const layoutSizeTransition: Transition = {
  duration: 0.42,
  ease: easeOutExpo
};

/**
 * Extra field expand/collapse (e.g. nickname on register).
 * Height + internal spacing (paddingTop) animate together so grid gap
 * doesn't snap when the field mounts/unmounts.
 */
export const expandFieldVariants: Variants = {
  hidden: {
    height: 0,
    opacity: 0,
    paddingTop: 0,
    transition: {
      height: { duration: 0.34, ease: easeOutExpo },
      paddingTop: { duration: 0.34, ease: easeOutExpo },
      opacity: { duration: 0.14, ease: "easeIn" }
    }
  },
  visible: {
    height: "auto",
    opacity: 1,
    paddingTop: 12,
    transition: {
      height: { duration: 0.4, ease: easeOutExpo },
      paddingTop: { duration: 0.4, ease: easeOutExpo },
      opacity: { duration: 0.26, ease: easeOutSoft, delay: 0.05 }
    }
  },
  exit: {
    height: 0,
    opacity: 0,
    paddingTop: 0,
    transition: {
      height: { duration: 0.34, ease: easeOutExpo },
      paddingTop: { duration: 0.34, ease: easeOutExpo },
      opacity: { duration: 0.12, ease: "easeIn" }
    }
  }
};

/** Instant variants when user prefers reduced motion */
export const reducedMotionVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.01 } },
  exit: { opacity: 0, transition: { duration: 0.01 } }
};

export function withReducedMotion(variants: Variants, reduced: boolean | null): Variants {
  if (reduced) return reducedMotionVariants;
  return variants;
}
