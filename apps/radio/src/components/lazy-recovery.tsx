import { captureError } from "@avoid.quest/error";
import { Button } from "@avoid.quest/ui/components/button";
import { cn } from "@avoid.quest/ui/lib/utils";
import { TriangleAlertIcon } from "lucide-react";
import {
  Component,
  type ComponentProps,
  type ComponentType,
  type ErrorInfo,
  type LazyExoticComponent,
  lazy,
  type ReactNode,
  useId,
} from "react";
import { createPortal } from "react-dom";

/** A lazy chunk that could not load: offline, or replaced by a deploy. */
class LazyLoadError extends Error {
  /** Lets the next render import the chunk again. */
  readonly reset: () => void;
  /** A retry failed too, so only a reload is likely to help. */
  readonly retried: boolean;

  constructor(cause: unknown, reset: () => void, retried: boolean) {
    super("A lazy chunk failed to load", { cause });
    this.name = "LazyLoadError";
    this.reset = reset;
    this.retried = retried;
  }
}

/**
 * `React.lazy` caches a rejected import, so a retry needs a fresh lazy type.
 * The fresh one is created only when `LazyBoundary` retries: React re-renders
 * once after an error, and swapping earlier would import again on its own.
 *
 * Some browsers keep a failed module fetch in their module map, so importing
 * the same URL again fails at once (HTML allowed refetching only in 2026, and
 * Safari still lags). After a failed retry, the fallback points to Reload.
 */
// biome-ignore lint/suspicious/noExplicitAny: matches React.lazy's own signature.
export function lazyWithRetry<T extends ComponentType<any>>(
  load: () => Promise<{ default: T }>
) {
  let failures = 0;
  const create = (): LazyExoticComponent<T> => {
    const instance = lazy(() =>
      load().then(
        (module) => {
          failures = 0;
          return module;
        },
        (error: unknown) => {
          failures += 1;
          throw new LazyLoadError(
            error,
            () => {
              if (current === instance) {
                current = create();
              }
            },
            failures > 1
          );
        }
      )
    );
    return instance;
  };
  let current = create();

  return function RetryableLazy(props: ComponentProps<T>) {
    const Lazy = current;
    return <Lazy {...props} />;
  };
}

type LoadFailedVariant = "icon" | "inline" | "panel";

type LoadFailedProps = {
  /** What failed, in a sentence: "Couldn't load {label}." */
  label: string;
  onRetry: () => void;
  /** A retry failed too; the message points to Reload instead. */
  retried?: boolean;
  variant?: LoadFailedVariant;
  className?: string;
};

// A reload stops playback, so it is only ever the listener's choice.
const reload = () => window.location.reload();

function LoadFailed({
  label,
  onRetry,
  retried = false,
  variant = "panel",
  className,
}: LoadFailedProps) {
  const popoverId = useId();
  const message = retried
    ? `Couldn't load ${label}, even after retrying.`
    : `Couldn't load ${label}.`;
  const hint = retried
    ? "Reload to try again. Reloading stops playback."
    : "Check your connection, then retry. Reloading stops playback.";

  if (variant === "icon") {
    // A native popover opens centred in the top layer with no positioning
    // library. The portal keeps icon-button styles from the header off its
    // actions, and `m-auto` restores the centring that preflight resets.
    return (
      <>
        <span className="sr-only" role="alert">
          {message}
        </span>
        <Button
          aria-label={`${message} Show options`}
          className={className}
          popoverTarget={popoverId}
          size="icon"
          type="button"
          variant="ghost"
        >
          <TriangleAlertIcon className="size-3.5" />
        </Button>
        {createPortal(
          <div
            className="m-auto w-64 rounded-md border bg-popover p-3 text-popover-foreground text-sm shadow-md"
            id={popoverId}
            popover="auto"
          >
            <p className="mb-1 font-medium">{message}</p>
            <p className="mb-3 text-muted-foreground text-xs">{hint}</p>
            <div className="flex justify-end gap-2">
              <Button onClick={reload} size="sm" type="button" variant="ghost">
                Reload
              </Button>
              <Button onClick={onRetry} size="sm" type="button">
                Retry
              </Button>
            </div>
          </div>,
          document.body
        )}
      </>
    );
  }

  if (variant === "inline") {
    return (
      <div
        className={cn(
          "flex h-7 min-w-0 items-center gap-1 text-muted-foreground text-xs",
          className
        )}
      >
        <p className="min-w-0 truncate" role="alert">
          {message}
        </p>
        <Button
          className="h-7 px-2 text-xs"
          onClick={onRetry}
          size="sm"
          type="button"
          variant="ghost"
        >
          Retry
        </Button>
        <Button
          className="h-7 px-2 text-xs"
          onClick={reload}
          size="sm"
          type="button"
          variant="ghost"
        >
          Reload
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex min-h-48 flex-col items-center justify-center gap-3 p-4 text-center text-sm",
        className
      )}
    >
      <div className="space-y-1">
        <p className="font-medium" role="alert">
          {message}
        </p>
        <p className="text-muted-foreground text-xs">{hint}</p>
      </div>
      <div className="flex gap-2">
        <Button onClick={reload} size="sm" type="button" variant="outline">
          Reload
        </Button>
        <Button onClick={onRetry} size="sm" type="button">
          Retry
        </Button>
      </div>
    </div>
  );
}

type LazyBoundaryProps = {
  children: ReactNode;
  label: string;
  variant?: LoadFailedVariant;
  className?: string;
  /** Places the failure where the content would have been, e.g. a dialog. */
  frame?: (failed: ReactNode) => ReactNode;
};

/**
 * Contains a failed `lazyWithRetry` import to the feature that needed it.
 * Other errors keep propagating to the boundary they reached before.
 */
export class LazyBoundary extends Component<
  LazyBoundaryProps,
  { error: unknown }
> {
  state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown, _info: ErrorInfo) {
    if (error instanceof LazyLoadError) {
      captureError(error, {
        operation: "lazy-load",
        surface: "ui",
        tags: { feature: this.props.label },
      });
    }
  }

  retry = () => {
    const { error } = this.state;
    if (error instanceof LazyLoadError) {
      error.reset();
    }
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (error === null) {
      return this.props.children;
    }
    if (!(error instanceof LazyLoadError)) {
      throw error;
    }
    const { className, frame, label, variant } = this.props;
    const failed = (
      <LoadFailed
        className={className}
        label={label}
        onRetry={this.retry}
        retried={error.retried}
        variant={variant}
      />
    );
    return frame ? frame(failed) : failed;
  }
}
