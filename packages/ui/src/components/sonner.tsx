"use client";

import {
  IconAlertOctagon,
  IconAlertTriangle,
  IconCircleCheck,
  IconInfoCircle,
  IconLoader,
} from "@tabler/icons-react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { forcedTheme, theme = "system" } = useTheme();

  return (
    <Sonner
      // Modal layers set `pointer-events: none` on <body>; toasts above them
      // must stay pressable.
      className="toaster group pointer-events-auto"
      icons={{
        success: <IconCircleCheck className="size-4" />,
        info: <IconInfoCircle className="size-4" />,
        warning: <IconAlertTriangle className="size-4" />,
        error: <IconAlertOctagon className="size-4" />,
        loading: <IconLoader className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      theme={(forcedTheme ?? theme) as ToasterProps["theme"]}
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  );
};

export { toast } from "sonner";
export { Toaster };
