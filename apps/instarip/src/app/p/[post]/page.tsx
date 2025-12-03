import { api } from "@workspace/backend/convex/_generated/api";
import { Button } from "@workspace/ui/components/button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { fetchQuery } from "convex/nextjs";
import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import MediaCard from "@/components/posts/media-card";
import PostDetailsWrapper from "@/components/posts/post-details-wrapper";

type PostPageProps = {
  params: Promise<{ post: string }>;
};

// export async function generateStaticParams() {
//   const posts = await getAllPosts();
//   const params = posts
//     .filter((post: Post) => post.shortcode !== null)
//     .map((post: Post) => ({ post: post.shortcode }));
//   return params;
// }

export default async function PostPage({ params }: PostPageProps) {
  const { post } = await params;
  const postData = await fetchQuery(api.posts.getPostByShortcode, {
    shortcode: post,
  });

  if (!postData) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="mb-4 font-bold text-2xl">Post not found</h1>
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

  const mediaItems = await fetchQuery(api.media_items.getMediaItemsByPostId, {
    postId: postData._id,
  });
  const isVideo = postData.is_video || postData.media_type === "video";

  return (
    <div>
      {/* Main Content Layout - 2/3 Media + 1/3 Caption */}
      <div className="grid grid-cols-1 gap-6 overflow-hidden lg:grid-cols-3">
        {/* Media Content - 2/3 width */}
        <Suspense
          fallback={<Skeleton className="aspect-square lg:col-span-2" />}
        >
          <MediaCard
            className="h-min w-full lg:col-span-2"
            isViewer
            mediaItems={mediaItems}
            post={postData}
          />
        </Suspense>

        {/* Caption and Actions - 1/3 width */}
        <Suspense
          fallback={
            <div className="flex flex-col justify-start">
              <div className="sticky top-24 space-y-6">
                <div className="rounded-lg border bg-card p-4">
                  <Skeleton className="mb-3 h-4 w-16" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="mt-2 h-4 w-3/4" />
                </div>
                <div className="space-y-3">
                  <Skeleton className="h-4 w-16" />
                  <div className="flex flex-col gap-2">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                  </div>
                </div>
              </div>
            </div>
          }
        >
          <PostDetailsWrapper isVideo={isVideo} postData={postData} />
        </Suspense>
      </div>
    </div>
  );
}
