import alchemy from "alchemy";
import { Nextjs } from "alchemy/cloudflare";
import { config } from "dotenv";

config({ path: "./.env" });

const app = await alchemy("my-app");

export const web = await Nextjs("web", {
  bindings: {},
  dev: {
    command: "bun run dev",
  },
});

console.log(`Web    -> ${web.url}`);

await app.finalize();
