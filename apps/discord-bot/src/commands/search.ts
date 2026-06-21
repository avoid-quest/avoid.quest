import type { UnifiedSearchResult } from "@avoid.quest/platforms";
import {
  searchBandcamp,
  searchRadioGarden,
  searchSoundCloud,
  searchYouTubeMusic,
  transformBandcampResults,
  transformRadioGardenResults,
  transformSoundCloudResults,
  transformYouTubeResults,
} from "@avoid.quest/platforms";
import type {
  ChatInputCommandInteraction,
  StringSelectMenuInteraction,
} from "discord.js";
import {
  ActionRowBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";
import { requestPlayback } from "../voice/playback-request.js";
import {
  getInvidiousOptions,
  getSoundCloudClientId,
  resolveTrack,
} from "../voice/stream-resolver.js";

export const data = new SlashCommandBuilder()
  .setName("search")
  .setDescription("Search for music across platforms")
  .addStringOption((option) =>
    option
      .setName("query")
      .setDescription("What to search for")
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("platform")
      .setDescription("Platform to search (default: all)")
      .setRequired(false)
      .addChoices(
        { name: "All", value: "all" },
        { name: "YouTube", value: "youtube" },
        { name: "SoundCloud", value: "soundcloud" },
        { name: "Bandcamp", value: "bandcamp" },
        { name: "Radio Garden", value: "radiogarden" }
      )
  );

const pendingSearches = new Map<string, UnifiedSearchResult[]>();

export async function execute(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const query = interaction.options.getString("query", true);
  const platform = interaction.options.getString("platform") ?? "all";

  await interaction.deferReply();

  try {
    const results = await searchPlatforms(query, platform);

    if (results.length === 0) {
      await interaction.editReply({ content: "No results found." });
      return;
    }

    const displayed = results.slice(0, 25);
    pendingSearches.set(interaction.id, displayed);

    const options = displayed.map((r, i) => {
      const label = `${r.title}`.slice(0, 100);
      const description = `${r.artist} [${r.platform}]`.slice(0, 100);
      return new StringSelectMenuOptionBuilder()
        .setLabel(label)
        .setDescription(description)
        .setValue(String(i));
    });

    const select = new StringSelectMenuBuilder()
      .setCustomId(`search:${interaction.id}`)
      .setPlaceholder("Select a track to play")
      .addOptions(options);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      select
    );

    await interaction.editReply({
      content: `Found ${results.length} results for "${query}":`,
      components: [row],
    });

    setTimeout(() => pendingSearches.delete(interaction.id), 60_000);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "An unknown error occurred";
    await interaction.editReply({ content: `Search failed: ${message}` });
  }
}

export async function handleSelection(
  interaction: StringSelectMenuInteraction
): Promise<void> {
  const interactionId = interaction.customId.split(":")[1];
  if (!interactionId) {
    return;
  }

  const results = pendingSearches.get(interactionId);
  if (!results) {
    await interaction.reply({
      content: "This search has expired. Please search again.",
      ephemeral: true,
    });
    return;
  }

  const index = Number.parseInt(interaction.values[0] ?? "0", 10);
  const selected = results[index];
  if (!selected) {
    await interaction.reply({
      content: "Invalid selection.",
      ephemeral: true,
    });
    return;
  }

  const playback = await requestPlayback(interaction, {
    messages: {
      voiceChannelRequired: "You need to be in a voice channel.",
      failurePrefix: "Failed to play",
    },
    loadTracks: (requestedBy) => resolveTrack(selected.url, requestedBy),
  });

  if (playback.status === "played") {
    pendingSearches.delete(interactionId);
  }
}

async function searchPlatforms(
  query: string,
  platform: string
): Promise<UnifiedSearchResult[]> {
  const results: UnifiedSearchResult[] = [];

  const searches: Promise<void>[] = [];

  if (platform === "all" || platform === "youtube") {
    searches.push(
      searchYouTubeMusic(query, "songs", getInvidiousOptions())
        .then((r) => {
          results.push(...transformYouTubeResults(r));
        })
        .catch(() => undefined)
    );
  }

  if (platform === "all" || platform === "soundcloud") {
    searches.push(
      getSoundCloudClientId()
        .then((clientId) => searchSoundCloud(query, clientId))
        .then((r) => {
          results.push(...transformSoundCloudResults(r));
        })
        .catch(() => undefined)
    );
  }

  if (platform === "all" || platform === "bandcamp") {
    searches.push(
      searchBandcamp(query)
        .then((r) => {
          results.push(...transformBandcampResults(r));
        })
        .catch(() => undefined)
    );
  }

  if (platform === "all" || platform === "radiogarden") {
    searches.push(
      searchRadioGarden(query)
        .then((r) => {
          results.push(...transformRadioGardenResults(r));
        })
        .catch(() => undefined)
    );
  }

  await Promise.all(searches);
  return results;
}
