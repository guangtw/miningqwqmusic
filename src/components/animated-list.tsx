"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MutableRefObject, ReactNode, Ref, UIEvent } from "react";
import { motion, useInView, useReducedMotion } from "motion/react";
import { springStagger } from "@/src/lib/motion-presets";

import styles from "./animated-list.module.css";

type AnimatedListProps<T> = {
  items: readonly T[];
  renderItem: (item: T, index: number, selected: boolean) => ReactNode;
  getItemKey?: (item: T, index: number) => string | number;
  onItemSelect?: (item: T, index: number) => void;
  showGradients?: boolean;
  enableArrowNavigation?: boolean;
  className?: string;
  listClassName?: string;
  itemClassName?: string;
  displayScrollbar?: boolean;
  initialSelectedIndex?: number;
  listRef?: Ref<HTMLDivElement>;
};

type AnimatedItemProps = {
  children: ReactNode;
  className?: string;
  delay: number;
  index: number;
  interactive: boolean;
  onClick?: () => void;
  onMouseEnter?: () => void;
};

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function AnimatedItem({ children, className, delay, index, interactive, onClick, onMouseEnter }: AnimatedItemProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const inView = useInView(ref, { amount: 0.25, once: true });
  const reducedMotion = useReducedMotion();

  return (
    <motion.div
      ref={ref}
      data-index={index}
      className={joinClasses(styles.item, interactive && styles.interactiveItem, className)}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      layout={!reducedMotion}
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 14 }}
      animate={inView ? { opacity: 1, y: 0 } : reducedMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
      transition={
        reducedMotion
          ? { duration: 0.01 }
          : {
              ...springStagger,
              delay: Math.min(delay, 0.24),
              layout: { duration: 0.22, ease: [0.22, 1, 0.36, 1] }
            }
      }
    >
      {children}
    </motion.div>
  );
}

function updateGradientState(container: HTMLDivElement, setTop: (value: number) => void, setBottom: (value: number) => void) {
  const { scrollTop, scrollHeight, clientHeight } = container;
  const topOpacity = Math.min(scrollTop / 36, 1);
  const bottomDistance = scrollHeight - (scrollTop + clientHeight);
  const bottomOpacity = scrollHeight <= clientHeight ? 0 : Math.min(bottomDistance / 48, 1);
  setTop(topOpacity);
  setBottom(bottomOpacity);
}

export default function AnimatedList<T>({
  items,
  renderItem,
  getItemKey,
  onItemSelect,
  showGradients = true,
  enableArrowNavigation = true,
  className,
  listClassName,
  itemClassName,
  displayScrollbar = true,
  initialSelectedIndex = -1,
  listRef: externalListRef
}: AnimatedListProps<T>) {
  const internalListRef = useRef<HTMLDivElement | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(initialSelectedIndex);
  const [keyboardNav, setKeyboardNav] = useState(false);
  const [topGradientOpacity, setTopGradientOpacity] = useState(0);
  const [bottomGradientOpacity, setBottomGradientOpacity] = useState(items.length > 4 ? 1 : 0);
  const isInteractive = typeof onItemSelect === "function";

  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    updateGradientState(event.currentTarget, setTopGradientOpacity, setBottomGradientOpacity);
  }, []);

  const scrollSelectedItemIntoView = useCallback(() => {
    if (!internalListRef.current || selectedIndex < 0) return;
    const container = internalListRef.current;
    const selectedItem = container.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`);
    if (!selectedItem) return;
    const extraMargin = 36;
    const containerScrollTop = container.scrollTop;
    const containerHeight = container.clientHeight;
    const itemTop = selectedItem.offsetTop;
    const itemBottom = itemTop + selectedItem.offsetHeight;

    if (itemTop < containerScrollTop + extraMargin) {
      container.scrollTo({ top: Math.max(itemTop - extraMargin, 0), behavior: "smooth" });
    } else if (itemBottom > containerScrollTop + containerHeight - extraMargin) {
      container.scrollTo({ top: itemBottom - containerHeight + extraMargin, behavior: "smooth" });
    }
  }, [selectedIndex]);

  useEffect(() => {
    const container = internalListRef.current;
    if (!container) return;
    updateGradientState(container, setTopGradientOpacity, setBottomGradientOpacity);
  }, [items.length]);

  useEffect(() => {
    if (!enableArrowNavigation || !isInteractive || !items.length) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey)) {
        event.preventDefault();
        setKeyboardNav(true);
        setSelectedIndex((previous) => Math.min(previous + 1, items.length - 1));
      } else if (event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey)) {
        event.preventDefault();
        setKeyboardNav(true);
        setSelectedIndex((previous) => Math.max(previous - 1, 0));
      } else if (event.key === "Enter" && selectedIndex >= 0 && selectedIndex < items.length) {
        event.preventDefault();
        onItemSelect?.(items[selectedIndex], selectedIndex);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enableArrowNavigation, isInteractive, items, onItemSelect, selectedIndex]);

  useEffect(() => {
    if (!keyboardNav) return;
    scrollSelectedItemIntoView();
    setKeyboardNav(false);
  }, [keyboardNav, scrollSelectedItemIntoView]);

  const handleItemKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>, item: T, index: number) => {
      if (!isInteractive) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setSelectedIndex(index);
        onItemSelect?.(item, index);
      }
    },
    [isInteractive, onItemSelect]
  );

  const setListNode = useCallback(
    (node: HTMLDivElement | null) => {
      internalListRef.current = node;
      if (!externalListRef) return;
      if (typeof externalListRef === "function") {
        externalListRef(node);
        return;
      }
      (externalListRef as MutableRefObject<HTMLDivElement | null>).current = node;
    },
    [externalListRef]
  );

  return (
    <div className={joinClasses(styles.container, className)}>
      <div
        ref={setListNode}
        className={joinClasses(styles.list, !displayScrollbar && styles.noScrollbar, listClassName)}
        onScroll={handleScroll}
      >
        {items.map((item, index) => {
          const selected = selectedIndex === index;
          return (
            <AnimatedItem
              key={getItemKey ? getItemKey(item, index) : index}
              delay={Math.min(index * 0.04, 0.28)}
              index={index}
              interactive={isInteractive}
              className={joinClasses(itemClassName, selected && isInteractive && styles.selected)}
              onMouseEnter={isInteractive ? () => setSelectedIndex(index) : undefined}
              onClick={
                isInteractive
                  ? () => {
                      setSelectedIndex(index);
                      onItemSelect?.(item, index);
                    }
                  : undefined
              }
            >
              <div
                role={isInteractive ? "button" : undefined}
                tabIndex={isInteractive ? 0 : -1}
                onKeyDown={(event) => handleItemKeyDown(event, item, index)}
              >
                {renderItem(item, index, selected)}
              </div>
            </AnimatedItem>
          );
        })}
      </div>
      {showGradients ? (
        <>
          <div className={joinClasses(styles.gradient, styles.topGradient)} style={{ opacity: topGradientOpacity }} />
          <div className={joinClasses(styles.gradient, styles.bottomGradient)} style={{ opacity: bottomGradientOpacity }} />
        </>
      ) : null}
    </div>
  );
}
