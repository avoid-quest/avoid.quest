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

  return (
    <div className="flex flex-col items-center gap-2">
      <Button
        className={cn("size-16 rounded-full", className)}
        disabled={isDisabled}
        onClick={onClick}
        size={size}
        variant={isPlaying && !isLoading ? "outline" : variant}
      >
        {renderIcon()}
      </Button>
      {isLoading && showLoadingText && (
        <div className="text-muted-foreground text-sm">{loadingText}</div>
      )}
    </div>
  );
}
