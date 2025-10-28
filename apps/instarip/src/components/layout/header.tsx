import AvoidLogo from "@workspace/ui/components/avoid-logo";
import Link from "next/link";

export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
      <div className="container mx-auto flex h-16 items-center justify-start px-4">
        <Link
          className="flex h-full flex-row items-center justify-center"
          href="/"
        >
          <AvoidLogo className="size-14" />
          <div className="flex flex-col items-start justify-center">
            <span className="font-semibold text-3xl leading-none tracking-tight">
              instarip
            </span>
            <span className="text-primary/80 text-sm leading-none">
              avoid.quest
            </span>
          </div>
        </Link>
      </div>
    </header>
  );
}
