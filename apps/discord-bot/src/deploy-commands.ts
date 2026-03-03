import { REST, Routes } from "discord.js";
import { commands } from "./commands/index.js";
import { config } from "./config.js";

const rest = new REST().setToken(config.discordToken());
const commandData = [...commands.values()].map((cmd) => cmd.data.toJSON());

const guildId = config.discordGuildId();
const clientId = config.discordClientId();

async function deploy(): Promise<void> {
  try {
    console.log(`Registering ${commandData.length} commands...`);

    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body: commandData,
      });
      console.log(`Registered commands to guild ${guildId}`);
    } else {
      await rest.put(Routes.applicationCommands(clientId), {
        body: commandData,
      });
      console.log("Registered global commands");
    }
  } catch (error) {
    console.error("Failed to register commands:", error);
    process.exit(1);
  }
}

deploy();
