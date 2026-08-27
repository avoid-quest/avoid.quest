"use client";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@avoid.quest/ui/components/avatar";
import { UserIcon } from "lucide-react";
import type { SyntheticEvent } from "react";

type UserAvatarProps = {
  className?: string;
  size?: "sm" | "md" | "lg";
  alt?: string;
  src?: string;
  fallback?: string;
  username?: string;
};

const sizeClasses = {
  lg: "h-12 w-12",
  md: "h-8 w-8",
  sm: "h-6 w-6",
};

const iconSizes = {
  lg: "h-6 w-6",
  md: "h-4 w-4",
  sm: "h-3 w-3",
};

function hideFailedAvatar(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.style.display = "none";
}

export default function UserAvatar({
  className = "",
  size = "md",
  alt = "User",
  src,
  fallback,
  username,
}: UserAvatarProps) {
  const sizeClass = sizeClasses[size];
  const iconSize = iconSizes[size];

  // Generate initials from username or use fallback
  const getInitials = () => {
    if (username) {
      return username
        .split(" ")
        .map((name) => name.charAt(0))
        .join("")
        .toUpperCase()
        .slice(0, 2);
    }
    return fallback || "U";
  };

  return (
    <Avatar className={`${sizeClass} ${className}`}>
      <AvatarImage alt={alt} onError={hideFailedAvatar} src={src} />
      <AvatarFallback className="flex items-center justify-center">
        {username ? (
          <span className="font-medium text-xs">{getInitials()}</span>
        ) : (
          <UserIcon className={iconSize} />
        )}
      </AvatarFallback>
    </Avatar>
  );
}
