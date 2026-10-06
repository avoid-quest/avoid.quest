import { useEffect, useState } from "react";

export function AboutYou() {
  const [browser, setBrowser] = useState<{
    language: string;
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    setBrowser({
      height: window.screen.height,
      language: navigator.language,
      width: window.screen.width,
    });
  }, []);

  return (
    <details className="py-3 text-xs">
      <summary className="cursor-pointer rounded-sm font-medium outline-none focus:ring-[3px] focus:ring-ring/50">
        What I know about you
      </summary>
      <div className="mt-3 space-y-2 text-muted-foreground leading-relaxed">
        <p>Any site can read this.</p>
        <p className="font-mono">
          {browser ? (
            <>
              Language: {browser.language} · Screen: {browser.width} ×{" "}
              {browser.height}
            </>
          ) : (
            "…"
          )}
        </p>
        <p>
          Your setup stays here. A random cookie identifies your session for one
          year.
        </p>
        <p>We count visits and report errors to keep playback working.</p>
      </div>
    </details>
  );
}
