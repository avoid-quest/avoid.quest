function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  discordToken: () => required("DISCORD_TOKEN"),
  discordClientId: () => required("DISCORD_CLIENT_ID"),
  discordGuildId: () => process.env.DISCORD_GUILD_ID,
  invidiousInstanceUrl: () =>
    process.env.INVIDIOUS_INSTANCE_URL || "https://yt.avoid.quest",
  invidiousAuth: () => process.env.INVIDIOUS_AUTH,
} as const;
