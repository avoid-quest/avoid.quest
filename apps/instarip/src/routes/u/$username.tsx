import { Button } from "@avoid.quest/ui/components/button";
import { Skeleton } from "@avoid.quest/ui/components/skeleton";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeftIcon, UserIcon } from "lucide-react";
import { useUserByUsername } from "@/lib/hooks/use-users";

export const Route = createFileRoute("/u/$username")({
  component: UserProfilePage,
});

function UserProfilePage() {
  const { username } = Route.useParams();
  const user = useUserByUsername(username);

  if (user === undefined) {
    return <UserProfileSkeleton />;
  }

  if (user === null) {
    return (
      <div className="container flex flex-col items-center justify-center py-12">
        <h1 className="mb-4 font-bold text-2xl">User not found</h1>
        <p className="mb-6 text-muted-foreground">
          The user @{username} doesn't exist.
        </p>
        <Link to="/">
          <Button>
            <ArrowLeftIcon className="mr-2 size-4" />
            Go back
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="container py-6">
      {/* Back button */}
      <Link className="mb-4 inline-block" to="/">
        <Button size="sm" variant="ghost">
          <ArrowLeftIcon className="mr-2 size-4" />
          Back
        </Button>
      </Link>

      {/* User header */}
      <div className="mb-6 flex items-center gap-4">
        <div className="flex size-16 items-center justify-center rounded-full bg-muted">
          <UserIcon className="size-8 text-muted-foreground" />
        </div>
        <div>
          <h1 className="font-bold text-2xl">@{user.username}</h1>
          {user.profile_url && (
            <a
              className="text-muted-foreground text-sm hover:text-primary"
              href={user.profile_url}
              rel="noopener noreferrer"
              target="_blank"
            >
              View on Instagram →
            </a>
          )}
        </div>
      </div>

      {/* Posts grid */}
      <h2 className="mb-4 font-semibold text-lg">Posts</h2>
      <p className="text-muted-foreground">
        User posts will be loaded here (requires backend query for posts by
        user)
      </p>
    </div>
  );
}

function UserProfileSkeleton() {
  return (
    <div className="container py-6">
      <Skeleton className="mb-4 h-10 w-24" />
      <div className="mb-6 flex items-center gap-4">
        <Skeleton className="size-16 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      <Skeleton className="mb-4 h-6 w-24" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Static skeleton loading state
          <Skeleton className="aspect-square rounded-lg" key={i} />
        ))}
      </div>
    </div>
  );
}
