# Discord Radio Bot — Setup Guide

## Prerequisites

- **Node.js 24** — matches the Docker runtime and build target. The installed
  `@discordjs/voice@0.19.2` requires at least Node 22.12.0.
- **Bun** (package manager)
- **ffmpeg** — required for audio transcoding

```sh
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt install ffmpeg
```

---

## 1. Create a Discord Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **"New Application"**
3. Name it (e.g. `avoid.quest radio`) and click **Create**

---

## 2. Get the Bot Token

1. In the left sidebar, click **"Bot"**
2. Under the bot's username, click **"Reset Token"**
3. **Copy the token** — this is your `DISCORD_TOKEN` (you won't be able to see it again)
4. Scroll down to **"Privileged Gateway Intents"** — leave them all off

---

## 3. Get the Client ID

1. In the left sidebar, click **"OAuth2"**
2. Copy the **Client ID** — this is your `DISCORD_CLIENT_ID`

---

## 4. Configure Installation and Invite the Bot

1. In the left sidebar, click **"Installation"**
2. Under **"Installation Contexts"**, uncheck **"User Install"** (keep only **"Guild Install"**)
3. Under **"Default Install Settings"** for Guild Install:
   - **Scopes**: add `bot` and `applications.commands`
   - **Permissions**: add `Connect` and `Speak`
4. Click **Save Changes**
5. Copy the **"Discord Provided Link"** from the top of the page and open it in your browser
6. Select the server you want to add the bot to and click **Authorize**

---

## 5. Get Your Guild (Server) ID

1. Open Discord
2. Go to **User Settings → Advanced → Developer Mode** and enable it
3. Right-click your server name in the sidebar
4. Click **"Copy Server ID"** — this is your `DISCORD_GUILD_ID`

---

## 6. Configure Development Secrets

Local development secrets are managed through Doppler. From the monorepo root,
install the Doppler CLI if needed, run `doppler login`, then run:

```sh
bun run secrets:setup
```

Store these variables in the selected Doppler development config:

```env
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
DISCORD_GUILD_ID=...
INVIDIOUS_INSTANCE_URL=https://yt.avoid.quest
INVIDIOUS_AUTH=...
```

`INVIDIOUS_AUTH` format is `username:password` (HTTP Basic Auth). Omit it if your instance has no auth.
Do not commit plaintext `.env` files, service tokens, or downloaded secret files.

---

## 7. Install Dependencies

From the monorepo root:

```sh
bun install --frozen-lockfile
```

---

## 8. Register Slash Commands

Registers the bot's commands with Discord. Run once, and again whenever commands change.

```sh
bun run --filter @avoid.quest/discord-bot deploy-commands
```

With `DISCORD_GUILD_ID` set, commands appear instantly in that server.

---

## 9. Start the Bot

```sh
# Development (auto-reload)
bun run --filter @avoid.quest/discord-bot dev

# Production (provide runtime secrets through the hosting environment)
bun run --filter @avoid.quest/discord-bot build
bun run --filter @avoid.quest/discord-bot start
```

`dev` and `deploy-commands` use Doppler; `start` runs Node directly and expects
the required variables in its environment. See [package scripts](package.json)
and the [Docker runtime](Dockerfile).

---

## 10. Verify

1. Console shows: `Logged in as <bot-name>#0000`
2. Bot appears online in your server
3. Type `/` in any channel — the bot's commands should appear
4. Join a voice channel, run `/radio nts` to test playback

---

## Commands

| Command | Description |
|---------|-------------|
| `/play <url>` | Play from Bandcamp, SoundCloud, YouTube, Radio Garden, or direct audio URL |
| `/radio [name]` | List preset stations or play one by name |
| `/search <query> [platform]` | Search across platforms, select from results |
| `/queue` | Show the current queue |
| `/skip` | Skip to the next track |
| `/nowplaying` | Show the current track |
| `/pause` | Pause playback |
| `/resume` | Resume playback |
| `/stop` | Stop playback, clear queue, and disconnect |
| `/volume <0-100>` | Set playback volume |
| `/clear` | Clear the queue |

---

## Troubleshooting

**Commands don't appear**
- Run `deploy-commands` again
- Verify `DISCORD_GUILD_ID` is correct

**No audio / silence**
- Check ffmpeg is installed: `ffmpeg -version`
- Check console for stream resolution errors

**"Failed to connect to voice channel"**
- Verify the bot has `Connect` and `Speak` permissions in the voice channel

**YouTube playback fails**
- Verify `INVIDIOUS_INSTANCE_URL` is reachable
- Check `INVIDIOUS_AUTH` is correct (format: `username:password`)
