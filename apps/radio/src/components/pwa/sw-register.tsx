import { useEffect } from "react";

export function SWRegister() {
  useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        })
        .catch(() => {
          // SW registration failure is non-critical
        });
    }
  }, []);

  return null;
}
