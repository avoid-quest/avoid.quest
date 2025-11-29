import AvoidLogo from "@workspace/ui/components/avoid-logo";

export function SiteLogo({
  href = "/",
  name,
}: {
  href?: string;
  name: string;
}) {
  return (
    <a className="flex h-full flex-row items-center justify-center" href={href}>
      <AvoidLogo className="size-14" />
      <div className="hidden flex-col items-start justify-center sm:flex">
        <span className="font-semibold text-3xl leading-none tracking-tight">
          {name}
        </span>
        <span className="text-primary/80 text-sm leading-none">
          avoid.quest
        </span>
      </div>
    </a>
  );
}
