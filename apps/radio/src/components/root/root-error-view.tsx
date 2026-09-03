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
      : "Something went wrong. Please try again.";

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
        <h1 className="mb-2 font-bold text-4xl">Something went wrong</h1>
        <p className="mb-6 text-muted-foreground">{safeMessage}</p>
        <div className="flex justify-center gap-3">
          <Button onClick={reset} size="lg">
            Try Again
          </Button>
          <Link to="/">
            <Button size="lg" variant="outline">
              <HomeIcon className="mr-2 size-4" />
              Go Home
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
        <h1 className="mb-2 font-bold text-6xl">404</h1>
        <h2 className="mb-4 font-semibold text-2xl">Page Not Found</h2>
        <p className="mb-6 text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Link to="/">
          <Button size="lg">
            <HomeIcon className="mr-2 size-4" />
            Go Home
          </Button>
        </Link>
      </div>
    </div>
  );
}
