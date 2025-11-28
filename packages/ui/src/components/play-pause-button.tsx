"use client";

import { Button } from "@workspace/ui/components/button";
import { Spinner } from "@workspace/ui/components/spinner";
import { cn } from "@workspace/ui/lib/utils";
import { Pause, Play } from "lucide-react";

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
  showLoadingText?: boolean;
  loadingText?: string;
  inline?: boolean;
};

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
      return <Pause className={cn("size-8", iconClassName)} />;
    }

    return <Play className={cn("size-8", iconClassName)} />;
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
      {isLoading && showLoadingText && (
        <div className="text-muted-foreground text-sm">{loadingText}</div>
      )}
    </div>
  );
}
