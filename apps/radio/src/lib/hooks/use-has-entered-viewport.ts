import { useEffect, useState } from "react";

export function useHasEnteredViewport<T extends Element>() {
  const [element, setElement] = useState<T | null>(null);
  const [hasEnteredViewport, setHasEnteredViewport] = useState(false);

  useEffect(() => {
    if (hasEnteredViewport) {
      return;
    }

    if (!element) {
      return;
    }

    if (typeof IntersectionObserver === "undefined") {
      setHasEnteredViewport(true);
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setHasEnteredViewport(true);
        observer.disconnect();
      }
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [element, hasEnteredViewport]);

  return { elementRef: setElement, hasEnteredViewport };
}
