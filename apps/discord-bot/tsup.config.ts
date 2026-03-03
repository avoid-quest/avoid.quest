import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  target: "node20",
  clean: true,
  noExternal: ["@avoid.quest/platforms"],
});
