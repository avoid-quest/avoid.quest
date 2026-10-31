import { fileURLToPath } from "node:url";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

/** Runs every story's render and play function in a real browser. Unit tests stay on `bun test`. */
export default defineConfig({
  test: {
    projects: ["light", "dark"].map((theme) => ({
      extends: true,
      plugins: [
        storybookTest({
          configDir: fileURLToPath(new URL("./.storybook", import.meta.url)),
          initialGlobals: { theme },
        }),
      ],
      test: {
        browser: {
          enabled: true,
          headless: true,
          instances: [{ browser: "chromium" }],
          provider: playwright({}),
        },
        name: `storybook-${theme}`,
      },
    })),
  },
});
