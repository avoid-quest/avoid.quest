import { createFileRoute } from "@tanstack/react-router";
import { Radios } from "@/components/radio";

export const Route = createFileRoute("/")({
  component: Home,
  // Disable SSR - this route uses TanStack DB with localStorage
  // which requires useSyncExternalStore that doesn't support SSR
  ssr: false,
});

function Home() {
  return (
    <div className="flex h-full w-full flex-col">
      <Radios />
    </div>
  );
}
