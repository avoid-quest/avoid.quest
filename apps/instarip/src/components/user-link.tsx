import { ArrowUpRightIcon } from "lucide-react";
import Link from "next/link";

export default function UserLink({
  username,
}: {
  username: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-start gap-0">
      <Link
        className="group/username inline-flex items-center gap-1 rounded-md px-2 py-1 text-left font-medium transition-all duration-200 hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        href={`/u/${username}`}
      >
        <span className="truncate">@{username}</span>
        <span className="opacity-0 transition-opacity group-hover/username:opacity-100 group-focus/username:opacity-100">
          <ArrowUpRightIcon className="h-3 w-3" />
        </span>
      </Link>
    </div>
  );
}
