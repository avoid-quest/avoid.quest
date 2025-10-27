import { ModeToggle } from "@workspace/ui/components/mode-toggle";

export function Footer() {
  return (
    <footer className="flex h-16 w-full items-center justify-end p-4">
      <ModeToggle />
    </footer>
  );
}
