// SPDX-License-Identifier: Apache-2.0
/** M3 VirtualList: a `role="list"` scroll container that renders only the visible items (TanStack Virtual). */
import { useVirtualizer } from "@tanstack/react-virtual";
import { type CSSProperties, type Key, type ReactNode, useRef } from "react";

export interface VirtualListProps<T> {
  items: readonly T[];
  renderItem: (item: T, index: number) => ReactNode;
  /** Scroll container height in px (the visible window). */
  height: number;
  /** Estimated item size in px (default 56, the M3 one-line list item); items are measured once rendered. */
  estimateSize?: number;
  overscan?: number;
  getKey?: (item: T, index: number) => Key;
  /** Gap between items in px. */
  gap?: number;
  /** Called when the last item becomes visible (infinite loading). */
  onEndReached?: () => void;
  "aria-label"?: string;
  className?: string;
  style?: CSSProperties;
}

export function VirtualList<T>(props: VirtualListProps<T>) {
  const {
    items,
    renderItem,
    height,
    estimateSize = 56,
    overscan = 6,
    getKey,
    gap = 0,
    onEndReached,
    className,
    style,
  } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const endReported = useRef(-1);
  // oxlint-disable-next-line react/incompatible-library -- TanStack Virtual renvoie des fonctions non mémoïsables (getVirtualItems, measureElement) : le compilateur React doit l'ignorer
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateSize,
    overscan,
    gap,
    getItemKey: getKey ? (index) => getKey(items[index]!, index) : undefined,
    initialRect: { width: 0, height },
  });
  const virtualItems = virtualizer.getVirtualItems();
  const last = virtualItems.at(-1);
  if (
    onEndReached &&
    last &&
    last.index === items.length - 1 &&
    endReported.current !== items.length
  ) {
    endReported.current = items.length;
    queueMicrotask(onEndReached);
  }

  return (
    <div
      ref={scrollRef}
      className={className}
      data-m3-virtual-list=""
      style={{
        height,
        overflow: "auto",
        contain: "strict",
        background: "var(--md-sys-color-surface)",
        color: "var(--md-sys-color-on-surface)",
        ...style,
      }}
    >
      <ul
        aria-label={props["aria-label"]}
        style={{
          position: "relative",
          width: "100%",
          height: virtualizer.getTotalSize(),
          margin: 0,
          padding: 0,
          listStyle: "none",
        }}
      >
        {virtualItems.map((item) => (
          <li
            key={item.key}
            aria-setsize={items.length}
            aria-posinset={item.index + 1}
            data-index={item.index}
            ref={virtualizer.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              margin: 0,
              listStyle: "none",
              transform: `translateY(${item.start}px)`,
            }}
          >
            {renderItem(items[item.index]!, item.index)}
          </li>
        ))}
      </ul>
    </div>
  );
}
