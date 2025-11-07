import { api, getHttpClient } from "../../../convex/client";
import type { AdminContext } from "../types";

export async function handleStatsCommand(ctx: AdminContext): Promise<void> {
  const unsent = await getHttpClient().query(api.posts.getUnsent, {
    limit: 1000,
  });
  const users = await getHttpClient().query(api.users.getUsers, {});

  // Get all posts count (approximate with a query)
  const recentPosts = await getHttpClient().query(api.posts.getPosts, {
    limit: 1000,
  });

  let statsText = "<b>📊 Database Statistics</b>\n\n";
  statsText += "<b>Posts:</b>\n";
  statsText += `  Total (recent): ${recentPosts.length}+ (showing first 1000)\n`;
  statsText += `  Unsent: ${unsent.length}\n`;
  statsText += `  Sent: ${recentPosts.filter((p) => p.sent).length}\n`;

  statsText += "\n<b>Users:</b>\n";
  statsText += `  Total: ${users.length}\n`;
  statsText += `  To Be Scraped: ${users.filter((u) => u.to_be_scraped).length}\n`;
  statsText += `  Not To Be Scraped: ${users.filter((u) => !u.to_be_scraped).length}\n`;

  await ctx.reply(statsText, { parse_mode: "HTML" });
}
