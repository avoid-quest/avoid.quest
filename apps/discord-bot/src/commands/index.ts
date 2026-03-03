import type { ChatInputCommandInteraction } from "discord.js";
import { clear, pause, resume, stop, volume } from "./controls.js";
import {
  data as nowplayingData,
  execute as nowplayingExecute,
} from "./nowplaying.js";
import { data as playData, execute as playExecute } from "./play.js";
import { data as queueData, execute as queueExecute } from "./queue.js";
import { data as radioData, execute as radioExecute } from "./radio.js";
import { data as searchData, execute as searchExecute } from "./search.js";
import { data as skipData, execute as skipExecute } from "./skip.js";

export type Command = {
  data: { name: string; toJSON: () => unknown };
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
};

const commandList: Command[] = [
  { data: playData, execute: playExecute },
  { data: radioData, execute: radioExecute },
  { data: searchData, execute: searchExecute },
  { data: queueData, execute: queueExecute },
  { data: skipData, execute: skipExecute },
  { data: nowplayingData, execute: nowplayingExecute },
  pause,
  resume,
  stop,
  volume,
  clear,
];

export const commands = new Map<string, Command>(
  commandList.map((cmd) => [cmd.data.name, cmd])
);

export { handleSelection as handleSearchSelection } from "./search.js";
