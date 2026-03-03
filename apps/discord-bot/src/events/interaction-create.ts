import type { Interaction } from "discord.js";
import { commands, handleSearchSelection } from "../commands/index.js";

export async function handleInteractionCreate(
  interaction: Interaction
): Promise<void> {
  if (interaction.isChatInputCommand()) {
    const command = commands.get(interaction.commandName);
    if (!command) {
      return;
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(
        `[Command] Error executing /${interaction.commandName}:`,
        error
      );
      const reply = {
        content: "An error occurred while executing this command.",
        ephemeral: true,
      };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply);
      } else {
        await interaction.reply(reply);
      }
    }
    return;
  }

  if (
    interaction.isStringSelectMenu() &&
    interaction.customId.startsWith("search:")
  ) {
    try {
      await handleSearchSelection(interaction);
    } catch (error) {
      console.error("[Search] Error handling selection:", error);
    }
  }
}
