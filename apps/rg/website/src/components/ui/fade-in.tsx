"use client";

import { useEffect, useRef } from "react";

interface AriaProps {
  role?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

export function FadeInStagger({
  children,
  className,
  as: Element = "div",
  faster = false,
  delay = 0,
  ...aria
}: {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "ul";
  faster?: boolean;
  delay?: number;
} & AriaProps) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }

    const staggerMs = faster ? 30 : 50;
    const delayMs = delay * 1000;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          const items = el.querySelectorAll<HTMLElement>("[data-fade-item]");
          items.forEach((item, i) => {
            item.style.transitionDelay = `${delayMs + i * staggerMs}ms`;
            item.classList.add("fade-item-visible");
          });
          observer.unobserve(el);
        }
      },
      { rootMargin: "-40px" },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [faster, delay]);

  return (
    <Element
      ref={(element: HTMLElement | null) => {
        ref.current = element;
      }}
      className={className}
      {...aria}
    >
      {children}
    </Element>
  );
}

export function FadeInItem({
  children,
  className,
  as: Element = "div",
  ...aria
}: { children: React.ReactNode; className?: string; as?: "div" | "li" } & AriaProps) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add("fade-item-visible");
          observer.unobserve(el);
        }
      },
      { rootMargin: "-40px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <Element
      ref={(element: HTMLElement | null) => {
        ref.current = element;
      }}
      data-fade-item=""
      className={`fade-item-hidden ${className || ""}`}
      {...aria}
    >
      {children}
    </Element>
  );
}
