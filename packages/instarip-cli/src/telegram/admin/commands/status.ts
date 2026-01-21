import { api, getHttpClient } from "../../../convex/client";
import { getSchedulerStatus } from "../../../scheduler";
import { getEffectiveSettings } from "../../../settings";
import type { AdminContext } from "../types";
import { formatSchedulerStatus, formatSettings } from "../utils";

export async function handleStatusCommand(ctx: AdminContext): Promise<void> {
  const schedulerStatus = getSchedulerStatus();
  const settings = await getEffectiveSettings();

  const statusText = formatSchedulerStatus(schedulerStatus);
  const settingsText = formatSettings(settings);

  // Get unsent posts count
  const unsent = await getHttpClient().query(api.posts.getUnsent, {
    limit: 1000,
  });
  const users = await getHttpClient().query(api.users.getUsers, {});

  let statsText = "\n<b>📊 Statistics</b>\n\n";
  statsText += `Unsent Posts: ${unsent.length}\n`;
  statsText += `Total Users: ${users.length}\n`;

  const fullText = `${statusText}\n${settingsText}${statsText}`;

  await ctx.reply(fullText, { parse_mode: "HTML" });
}
