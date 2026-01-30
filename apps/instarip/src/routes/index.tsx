import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="font-bold text-4xl">Instarip</h1>
      <p className="mt-4 text-muted-foreground">
        Instagram post viewer - Coming soon
      </p>
    </div>
  );
}
