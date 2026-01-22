import { Skeleton } from "@avoid.quest/ui/components/skeleton";

export function RadioSkeleton() {
  return (
    <div className="flex h-[100px] w-[350px] items-center justify-center space-x-2 p-2">
      <Skeleton className="h-12 w-12 rounded-full" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-[250px]" />
        <Skeleton className="h-4 w-[200px]" />
      </div>
    </div>
  );
}
