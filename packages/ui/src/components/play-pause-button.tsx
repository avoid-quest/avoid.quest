"use client";

import { Button } from "@avoid.quest/ui/components/button";
import { Spinner } from "@avoid.quest/ui/components/spinner";
import { cn } from "@avoid.quest/ui/lib/utils";
import { PauseIcon, PlayIcon } from "lucide-react";

type PlayPauseButtonProps = {
  isPlaying: boolean;
  isLoading?: boolean;
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
  /** When true, displays loading text below the button. Ignored when `inline={true}`. */
  showLoadingText?: boolean;
  /** Text to display when loading. Only shown when `showLoadingText={true}` and `inline={false}`. */
  loadingText?: string;
  /** When true, renders only the button without the wrapper container. Loading text is not displayed in inline mode. */
  inline?: boolean;
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
  disabled = false,
  onClick,
  size = "lg",
  variant = "default",
  className,
  iconClassName,
  showLoadingText = false,
  loadingText = "Loading...",
  inline = false,
}: PlayPauseButtonProps) {
  const isDisabled = disabled || isLoading;

  const renderIcon = () => {
    if (isLoading) {
      return <Spinner className={cn("size-8", iconClassName)} />;
    }

    if (isPlaying) {
      return <PauseIcon className={cn("size-8", iconClassName)} />;
    }

    return <PlayIcon className={cn("size-8", iconClassName)} />;
  };

  const button = (
    <Button
      className={cn(inline ? "" : "size-16 rounded-full", className)}
      disabled={isDisabled}
      onClick={onClick}
      size={size}
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
