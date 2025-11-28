import { createFileRoute } from "@tanstack/react-router";
import { Radios } from "@/components/radio";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <div className="flex h-full w-full flex-col">
      <Radios />
    </div>
  );
}
