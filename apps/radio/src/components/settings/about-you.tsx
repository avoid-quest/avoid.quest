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
      <dl className="mt-3 space-y-3 leading-relaxed">
        <div>
          <dt className="font-medium">This browser</dt>
          <dd className="text-muted-foreground">
            {browser ? (
              <>
                Language: {browser.language} · Screen: {browser.width} ×{" "}
                {browser.height} CSS pixels
              </>
            ) : (
              "Reading browser details…"
            )}
            <br />
            Read here locally. Umami also collects these values.
          </dd>
        </div>
        <div>
          <dt className="font-medium">Saved here</dt>
          <dd className="text-muted-foreground">
            Stations, settings, saved sessions, Node patches and MIDI mappings
            are saved in this browser.
          </dd>
        </div>
        <div>
          <dt className="font-medium">Analytics · Umami</dt>
          <dd className="text-muted-foreground">
            Visits, referrers, device details and approximate location show how
            Radio is used. Umami uses your IP for location and session counts
            without storing it. Page query strings and fragments are excluded.
            Umami respects Do Not Track.
          </dd>
        </div>
        <div>
          <dt className="font-medium">Errors and app health · Sentry</dt>
          <dd className="text-muted-foreground">
            Errors, app version, technical context and anonymous app-health
            sessions help us fix broken playback. Our Sentry configuration
            disables automatic IP, cookie and request-body collection.
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-muted-foreground leading-relaxed">
        Services you contact can see your connection IP. Media providers and
        relays have their own data practices. Feedback you send goes to GitHub.
      </p>
    </details>
  );
}
