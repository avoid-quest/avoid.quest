import { Button } from "@workspace/ui/components/button";
import { ExternalLink, PlayIcon } from "lucide-react";
import Link from "next/link";
import { formatCompactDate } from "@/lib/date-utils";
import type { Post } from "@/lib/types";
import UserLink from "../user-link";

type PostDetailsWrapperProps = {
  postData: Post;
  isVideo: boolean;
  username: string;
};

export default function PostDetailsWrapper({
  postData,
  isVideo,
  username,
}: PostDetailsWrapperProps) {
  return (
    <div className="flex max-h-[calc(100vh-10rem)] flex-col justify-start overflow-hidden">
      <div className="no-scrollbar space-y-6 overflow-auto">
        <UserLink username={username || "username"}>
          {formatCompactDate(postData.timestamp)}
        </UserLink>
        {/* Caption */}
        {postData.caption && (
          <div className="rounded-lg border bg-card p-4">
            <h3 className="mb-3 font-medium text-muted-foreground text-sm">
              Caption
            </h3>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {postData.caption}
            </p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="space-y-3">
          <h3 className="font-medium text-muted-foreground text-sm">Actions</h3>
          <div className="flex flex-col gap-2">
            {postData.url && (
              <Link
                href={postData.url}
                rel="noopener noreferrer"
                target="_blank"
              >
                <Button
                  className="w-full justify-start"
                  size="sm"
                  variant="outline"
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  View Original Post
                </Button>
              </Link>
            )}
            {postData.video_url && isVideo && (
              <Link
                href={postData.video_url}
                rel="noopener noreferrer"
                target="_blank"
              >
                <Button
                  className="w-full justify-start"
                  size="sm"
                  variant="outline"
                >
                  <PlayIcon className="mr-2 h-4 w-4" />
                  Play Video Directly
                </Button>
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
