import { api } from "@avoid.quest/backend/convex/_generated/api";
import type { Doc } from "@avoid.quest/backend/convex/_generated/dataModel";
import { Button } from "@avoid.quest/ui/components/button";
import { PostsGridSkeleton } from "@avoid.quest/ui/components/skeletons";
import { fetchQuery } from "convex/nextjs";
import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import PostCard from "@/components/posts/post-card";

type UserPageProps = {
  params: Promise<{ username: string }>;
};

export async function generateStaticParams() {
  const users = await fetchQuery(api.users.getUsers, {});
  return users.map((user: Doc<"users">) => ({
    username: user.username,
  }));
}

export async function generateMetadata({
  params,
}: UserPageProps): Promise<Metadata> {
  const { username } = await params;
  const user = await fetchQuery(api.users.getUserByUsername, { username });

  if (!user) {
    return {
      title: "User not found",
    };
  }

  return {
    title: `${user.username} - Posts`,
    description: `View all posts by ${user.username}.`,
    openGraph: {
      title: `${user.username} - Posts`,
      description: `View all posts by ${user.username}.`,
      type: "profile",
    },
  };
}

export default async function UserPage({ params }: UserPageProps) {
  const { username } = await params;
  const user = await fetchQuery(api.users.getUserByUsername, { username });

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="mb-4 font-bold text-2xl">User not found</h1>
          <Link href="/">
            <Button variant="outline">
              <ArrowLeftIcon className="mr-2 h-4 w-4" />
              Back to Feed
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const userPosts = await fetchQuery(api.posts.getPostsByUserId, {
    userId: user?._id,
  });

  return (
    <div>
      <h1 className="mb-4 font-bold text-2xl">@{user.username}</h1>

      <div className="mb-6">
        <Suspense fallback={<PostsGridSkeleton count={8} />}>
          <div className="flex flex-wrap items-center justify-center gap-4 p-24">
            {userPosts?.map((post) => (
              <PostCard key={post._id} post={post} />
            ))}
          </div>
        </Suspense>
      </div>
    </div>
  );
}
