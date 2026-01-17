import { type ReactNode, useEffect, useState } from "react";

type ClientOnlyProps = {
  children: ReactNode;
  fallback?: ReactNode;
};

/**
 * Renders children only on the client side after hydration.
 * Useful for components that use hooks incompatible with SSR
 * (like useSyncExternalStore without getServerSnapshot).
 */
export function ClientOnly({ children, fallback = null }: ClientOnlyProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return fallback;
  }

  return children;
}
