"use client";

import { api } from "@workspace/backend/convex/_generated/api";
import type { Doc } from "@workspace/backend/convex/_generated/dataModel";
import { Button } from "@workspace/ui/components/button";
import { useQuery } from "convex/react";
import { ExternalLinkIcon, PlayIcon } from "lucide-react";
import Link from "next/link";
import { formatCompactDate } from "@/lib/date-utils";
import UserLink from "../user-link";

type PostDetailsWrapperProps = {
  postData: Doc<"posts">;
  isVideo: boolean;
};

export default function PostDetailsWrapper({
  postData,
  isVideo,
}: PostDetailsWrapperProps) {
  const username = useQuery(api.users.getUsersByIds, { ids: postData.users });

  return (
    <div className="flex max-h-[calc(100vh-10rem)] flex-col justify-start overflow-hidden">
      <div className="no-scrollbar space-y-6 overflow-auto">
        <div className="flex flex-col items-start gap-1">
          {username?.map((user) => (
            <UserLink key={user?._id} username={user?.username || ""} />
          ))}
          <p className="ml-2 text-start text-muted-foreground text-xs">
            {" "}
            {formatCompactDate(postData.timestamp)}
          </p>
        </div>
        {/* Caption */}
        {postData.caption?.trim() !== "" && (
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
            {postData.url?.trim() !== "" && (
              <Link
                href={{
                  href: postData.url,
                }}
                rel="noopener noreferrer"
                target="_blank"
              >
                <Button
                  className="w-full justify-start"
                  size="sm"
                  variant="outline"
                >
                  <ExternalLinkIcon className="mr-2 h-4 w-4" />
                  View Original Post
                </Button>
              </Link>
            )}
            {postData.video_url?.trim() !== "" && isVideo.valueOf() && (
              <Link
                href={{
                  href: postData.video_url,
                }}
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
