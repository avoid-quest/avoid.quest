import { AppError, captureError } from "@avoid.quest/error";
import { Button } from "@avoid.quest/ui/components/button";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { HomeIcon } from "lucide-react";
import { useEffect } from "react";

export function RootErrorView({ error, reset }: ErrorComponentProps) {
  const safeMessage =
    error instanceof AppError
      ? error.safeMessage
      : "An unexpected error stopped this page.";

  useEffect(() => {
    captureError(error, {
      operation: "root-error-boundary",
      surface: "ui",
      tags: { route: "__root" },
    });
  }, [error]);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center p-8">
      <div className="text-center">
        <h1 className="mb-2 font-semibold text-lg">Something went wrong</h1>
        <p className="mb-6 text-muted-foreground text-sm">{safeMessage}</p>
        <div className="flex justify-center gap-3">
          <Button onClick={reset} size="sm">
            Try again
          </Button>
          <Link to="/">
            <Button size="sm" variant="outline">
              <HomeIcon className="size-3.5" />
              Go home
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

export function NotFoundView() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center p-8">
      <div className="text-center">
        <h1 className="mb-2 font-semibold text-lg">Page not found</h1>
        <p className="mb-6 text-muted-foreground text-sm">
          This page doesn't exist or has moved.
        </p>
        <Link to="/">
          <Button size="sm">
            <HomeIcon className="size-3.5" />
            Go home
          </Button>
        </Link>
      </div>
    </div>
  );
}
