import { useEffect, useRef, useState } from "react";

/** Pause visual telemetry outside the canvas or the page, keeping nodes mounted. */
export function useNodeVisibility<T extends Element>() {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry) {
          setVisible(entry.isIntersecting);
        }
      },
      { root: element.closest(".react-flow") }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, visible };
}
