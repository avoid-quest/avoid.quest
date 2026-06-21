import { searchBandcamp } from "@avoid.quest/platforms/bandcamp/search";
import { searchRadioGarden } from "@avoid.quest/platforms/radiogarden/search";
import type {
  SearchPlatform,
  UnifiedSearchResult,
} from "@avoid.quest/platforms/search";
import { createExternalPlatformSearchWorkflow } from "@avoid.quest/platforms/search";
import { searchSoundCloud } from "@avoid.quest/platforms/soundcloud/search";
import { searchYouTubeMusic } from "@avoid.quest/platforms/youtube/search";
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

const externalPlatformSearchWorkflow = createExternalPlatformSearchWorkflow({
  adapters: {
    bandcamp: {
      search: (query, filter) => searchBandcamp(query, filter),
    },
    radiogarden: {
      search: (query) => searchRadioGarden(query),
    },
    soundcloud: {
      search: async (query) =>
        searchSoundCloud(query, await getSoundCloudClientId()),
    },
    youtube: {
      search: (query, filter) =>
        searchYouTubeMusic(query, filter, getInvidiousOptions()),
    },
  },
  allProviderResultsMode: "append-by-completion",
  allProviderSearchParams: {
    bandcamp: { bandcampFilter: "" },
    youtube: { youtubeFilter: "songs" },
  },
});

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
      serverRequired: "This selection can only be used in a server.",
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
  try {
    return await externalPlatformSearchWorkflow.search({
      platform: platform as SearchPlatform,
      query,
      youtubeFilter: "songs",
    });
  } catch {
    return [];
  }
}
