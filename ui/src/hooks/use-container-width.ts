import { useCallback, useLayoutEffect, useState } from "react";

/**
 * Measures the content width of a DOM element via ResizeObserver.
 *
 * Returns a stable ref callback and the current width (0 until mounted).
 * Reads the initial size synchronously (useLayoutEffect) so a sidebar never
 * flashes at full width before collapsing on a narrow container.
 */
export function useContainerWidth(): [
  ref: (el: HTMLDivElement | null) => void,
  width: number,
] {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  const ref = useCallback((node: HTMLDivElement | null) => {
    setEl(node);
  }, []);

  useLayoutEffect(() => {
    if (!el) {
      setWidth(0);
      return;
    }
    setWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      setWidth(entries[0]?.contentRect.width ?? 0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);

  return [ref, width];
}
