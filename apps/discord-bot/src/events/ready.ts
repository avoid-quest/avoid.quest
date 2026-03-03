import { generateDependencyReport } from "@discordjs/voice";
import { ActivityType, type Client, REST, Routes } from "discord.js";
import { commands } from "../commands/index.js";
import { config } from "../config.js";

async function deployCommands(clientId: string): Promise<void> {
  const rest = new REST().setToken(config.discordToken());
  const body = [...commands.values()].map((cmd) => cmd.data.toJSON());
  const guildId = config.discordGuildId();

  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body,
    });
    console.log(`Registered ${body.length} commands to guild ${guildId}`);
  } else {
    await rest.put(Routes.applicationCommands(clientId), { body });
    console.log(`Registered ${body.length} global commands`);
  }
}

export async function handleReady(client: Client<true>): Promise<void> {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(generateDependencyReport());

  try {
    await deployCommands(client.user.id);
  } catch (error) {
    console.error("Failed to register commands:", error);
  }

  client.user.setActivity("music", { type: ActivityType.Listening });
}
