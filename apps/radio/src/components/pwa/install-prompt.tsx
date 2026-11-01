/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
import { Button } from "@avoid.quest/ui/components/button";
import { IconDownload } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const INSTALL_SNOOZE_KEY = "pwa-install-dismissed";
const INSTALL_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

function persistInstallSnooze(until: number): void {
  try {
    localStorage.setItem(INSTALL_SNOOZE_KEY, String(until));
  } catch {
    // The in-memory snooze still applies when storage is unavailable.
  }
}

function readInstallSnooze(): number {
  try {
    const stored = localStorage.getItem(INSTALL_SNOOZE_KEY);
    if (stored === "true") {
      // Convert permanent dismissals once, without immediately prompting again.
      const until = Date.now() + INSTALL_SNOOZE_MS;
      persistInstallSnooze(until);
      return until;
    }
    const until = Number(stored);
    return Number.isFinite(until) && until > 0 ? until : 0;
  } catch {
    return 0;
  }
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const snoozedUntil = useRef(0);

  useEffect(() => {
    // Check if already installed (standalone mode)
    const isStandaloneMode =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as { standalone?: boolean }).standalone === true;

    setIsStandalone(isStandaloneMode);

    snoozedUntil.current = readInstallSnooze();
    const refreshSnooze = () => {
      snoozedUntil.current = Math.max(
        snoozedUntil.current,
        readInstallSnooze()
      );
      setShowPrompt(Date.now() >= snoozedUntil.current);
    };

    // Keep the browser event even while snoozed; "Not now" does not consume it.
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      refreshSnooze();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshSnooze();
      }
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    // Reuse a retained event when returning after expiry, without a month-long timer.
    window.addEventListener("focus", refreshSnooze);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", refreshSnooze);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt
      );
    };
  }, []);

  const handleDismiss = () => {
    snoozedUntil.current = Date.now() + INSTALL_SNOOZE_MS;
    persistInstallSnooze(snoozedUntil.current);
    setShowPrompt(false);
  };

  const handleInstallClick = async () => {
    if (!deferredPrompt) {
      return;
    }

    setIsInstalling(true);

    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;

      if (outcome === "accepted") {
        setShowPrompt(false);
        setDeferredPrompt(null);
      } else {
        handleDismiss();
        // The browser prompt consumed this event; wait for a new one.
        setDeferredPrompt(null);
      }
    } catch {
      // Install prompt error is non-critical
    } finally {
      setIsInstalling(false);
    }
  };

  if (isStandalone || !showPrompt || !deferredPrompt) {
    return null;
  }

  return (
    <div className="slide-in-from-bottom-4 fade-in-0 fixed right-4 bottom-4 left-4 z-50 mx-auto max-w-md animate-in md:left-auto">
      <div className="border border-border/50 bg-card/95 p-3 shadow-lg backdrop-blur-xl">
        <div className="flex items-start gap-2">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center bg-primary/10">
            <IconDownload className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 space-y-3">
            <div>
              <h3 className="font-semibold text-sm leading-none">
                Install radio as an app
              </h3>
              <p className="mt-1 text-muted-foreground text-xs">
                Open radio in its own window.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                className="h-8"
                disabled={isInstalling}
                onClick={handleInstallClick}
                size="sm"
              >
                <IconDownload className="h-3.5 w-3.5" />
                {isInstalling ? "Installing…" : "Install"}
              </Button>
              <Button
                className="h-8"
                onClick={handleDismiss}
                size="sm"
                variant="ghost"
              >
                Not now
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
