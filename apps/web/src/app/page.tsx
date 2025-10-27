import AvoidLogo from "@workspace/ui/components/avoid-logo";
import { Button } from "@workspace/ui/components/button";
import Link from "next/link";

export default function AvoidQuest() {
  return (
    <div className="flex h-full flex-col items-center justify-center">
      <AvoidLogo className="-mb-10 size-64" />
      <small className="font-mono text-muted-foreground text-xs">
        avoid.quest
      </small>

      <div className="mt-10 flex flex-row items-center justify-center gap-4">
        <Link href="https://instarip.avoid.quest" target="_blank">
          <Button variant="link">instarip</Button>
        </Link>
        <Link href="https://radio.avoid.quest" target="_blank">
          <Button variant="link">radio</Button>
        </Link>
      </div>
    </div>
  );
}
