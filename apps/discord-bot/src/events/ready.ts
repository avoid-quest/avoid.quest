import { ActivityType, type Client } from "discord.js";

export function handleReady(client: Client<true>): void {
  console.log(`Logged in as ${client.user.tag}`);
  client.user.setActivity("music", { type: ActivityType.Listening });
}
