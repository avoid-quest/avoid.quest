import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],
  target: "node24",
  clean: true,
  noExternal: ["@avoid.quest/platforms"],
});
