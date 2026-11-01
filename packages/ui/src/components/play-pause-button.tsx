/** biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers */
"use client";

import { Button } from "@avoid.quest/ui/components/button";
import { Spinner } from "@avoid.quest/ui/components/spinner";
import { cn } from "@avoid.quest/ui/lib/utils";
import { IconPlayerPause, IconPlayerPlay } from "@tabler/icons-react";

type PlayPauseButtonProps = {
  isPlaying: boolean;
  isLoading?: boolean;
  /** Allow the transport to cancel a pending connection. */
  allowCancelWhileLoading?: boolean;
  disabled?: boolean;
  onClick: () => void;
  size?: "sm" | "default" | "lg" | "icon";
  variant?:
    | "default"
    | "destructive"
    | "outline"
    | "secondary"
    | "ghost"
    | "link";
  className?: string;
  iconClassName?: string;
  title?: string;
  /** When true, displays loading text below the button. Ignored when `inline={true}`. */
  showLoadingText?: boolean;
  /** Text to display when loading. Only shown when `showLoadingText={true}` and `inline={false}`. */
  loadingText?: string;
  /** When true, renders only the button without the wrapper container. Loading text is not displayed in inline mode. */
  inline?: boolean;
  /** What plays, for the accessible name: "Play {label}". */
  label?: string;
};

/**
 * A button component that toggles between play and pause states.
 *
 * @remarks
 * When `inline={true}`, the component renders only the button without any wrapper
 * or loading text, making it suitable for inline use in text or compact layouts.
 * The `showLoadingText` prop is ignored when `inline={true}`.
 */
export function PlayPauseButton({
  isPlaying,
  isLoading = false,
  allowCancelWhileLoading = false,
  disabled = false,
  onClick,
  size = "lg",
  variant = "default",
  className,
  iconClassName,
  title,
  showLoadingText = false,
  loadingText = "Loading…",
  inline = false,
  label,
}: PlayPauseButtonProps) {
  const playPauseLabel = [isPlaying ? "Pause" : "Play", label]
    .filter(Boolean)
    .join(" ");
  // Loading stays focusable while ignoring clicks, unless the transport
  // opts into cancelling its pending connection.
  const handleClick = () => {
    if (!disabled && (!isLoading || allowCancelWhileLoading)) {
      onClick();
    }
  };

  const renderIcon = () => {
    if (isLoading) {
      return <Spinner className={cn("size-8", iconClassName)} />;
    }

    if (isPlaying) {
      return <IconPlayerPause className={cn("size-8", iconClassName)} />;
    }

    return <IconPlayerPlay className={cn("size-8", iconClassName)} />;
  };

  const loadingLabel = allowCancelWhileLoading ? "Cancel" : "Loading";
  const button = (
    <Button
      aria-disabled={(isLoading && !allowCancelWhileLoading) || undefined}
      aria-label={
        isLoading
          ? [loadingLabel, label].filter(Boolean).join(" ")
          : playPauseLabel
      }
      className={cn(
        inline ? "" : "size-16 rounded-full",
        isLoading && "cursor-progress",
        className
      )}
      disabled={disabled}
      onClick={handleClick}
      size={size}
      title={title}
      variant={variant}
    >
      {renderIcon()}
    </Button>
  );

  if (inline) {
    return button;
  }

  return (
    <div className="flex flex-col items-center gap-2">
      {button}
      {isLoading.valueOf() && showLoadingText.valueOf() && (
        <div className="text-muted-foreground text-sm">{loadingText}</div>
      )}
    </div>
  );
}
