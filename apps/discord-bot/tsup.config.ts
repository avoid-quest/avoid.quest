import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  entry: ["src/index.ts"],
  format: ["cjs"],
  noExternal: ["@avoid.quest/platforms"],
  target: "node24",
});
