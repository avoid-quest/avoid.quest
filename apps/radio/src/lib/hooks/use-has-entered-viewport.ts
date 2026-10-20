import { useEffect, useState } from "react";

export function useHasEnteredViewport<T extends Element>() {
  const [element, setElement] = useState<T | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [hasEnteredViewport, setHasEnteredViewport] = useState(false);

  useEffect(() => {
    if (!element) {
      return;
    }

    if (typeof IntersectionObserver === "undefined") {
      setHasEnteredViewport(true);
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      const visible = entries.some((entry) => entry.isIntersecting);
      setIsVisible(visible);
      if (visible) {
        setHasEnteredViewport(true);
      }
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return { elementRef: setElement, hasEnteredViewport, isVisible };
}
