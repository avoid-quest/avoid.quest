import { Client, Events, GatewayIntentBits } from "discord.js";
import { config } from "./config.js";
import { handleInteractionCreate } from "./events/interaction-create.js";
import { handleReady } from "./events/ready.js";
import { handleVoiceStateUpdate } from "./events/voice-state-update.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

client.once(Events.ClientReady, handleReady);
client.on(Events.InteractionCreate, handleInteractionCreate);
client.on(Events.VoiceStateUpdate, handleVoiceStateUpdate);

client.login(config.discordToken());

function shutdown() {
  console.log("Shutting down...");
  client.destroy();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
