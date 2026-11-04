import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import babel from "@rolldown/plugin-babel";
import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";
import { reactCompilerPreset } from "@vitejs/plugin-react";
import { mergeConfig } from "vite";
import { RADIO_CHANGELOG_NEWEST_DATE } from "../../radio/src/storybook/changelog.fixture.ts";

/** Resolves a package's directory so Storybook finds addons from inside a Bun workspace. */
function getAbsolutePath(value: string) {
  return dirname(fileURLToPath(import.meta.resolve(`${value}/package.json`)));
}

const RADIO_ALIAS = /^@\//;
// Radio's specifiers for its mode lifecycle, which starts audio engines and
// reaches server functions. See `mode-lifecycle-requests.stub.ts`.
const RADIO_MODE_LIFECYCLE = /^(?:@\/lib|\.)\/mode-lifecycle-requests$/;
// Radio's TanStack Start server functions. See `server-functions.stub.ts`.
const RADIO_SERVER_FUNCTIONS = /^@\/utils\/[a-z-]+\.functions$/;
const VIRTUAL_CHANGELOG = /^virtual:changelog$/;

const fromHere = (path: string) =>
  fileURLToPath(new URL(path, import.meta.url));
const radioSrc = fromHere("../../radio/src");
const radioStorybook = `${radioSrc}/storybook`;
const radioVersion: string = JSON.parse(
  readFileSync(fromHere("../../radio/package.json"), "utf8")
).version;

const config: StorybookConfig = {
  addons: [
    getAbsolutePath("@storybook/addon-docs"),
    getAbsolutePath("@storybook/addon-a11y"),
    getAbsolutePath("@storybook/addon-themes"),
    getAbsolutePath("@storybook/addon-vitest"),
  ],
  framework: getAbsolutePath("@storybook/react-vite"),
  stories: [
    "../../../packages/ui/src/stories/**/*.stories.@(ts|tsx)",
    "../../radio/src/**/*.stories.@(ts|tsx)",
  ],
  // Deliberately not Radio's Vite config: no TanStack Start, Cloudflare,
  // Sentry or worklet plugins. Only what the stories' modules need.
  viteFinal(viteConfig) {
    return mergeConfig(viteConfig, {
      define: {
        __APP_VERSION__: JSON.stringify(radioVersion),
        __CHANGELOG_NEWEST_DATE__: JSON.stringify(RADIO_CHANGELOG_NEWEST_DATE),
        __SENTRY_RELEASE__: JSON.stringify(`radio@${radioVersion}-storybook`),
      },
      optimizeDeps: {
        include: [
          "@avoid.quest/ui > @base-ui/react/accordion",
          "@avoid.quest/ui > @base-ui/react/checkbox",
          "@avoid.quest/ui > @base-ui/react/collapsible",
          "@avoid.quest/ui > @base-ui/react/context-menu",
          "@avoid.quest/ui > @base-ui/react/dialog",
          "@avoid.quest/ui > @base-ui/react/menu",
          "@avoid.quest/ui > @base-ui/react/merge-props",
          "@avoid.quest/ui > @base-ui/react/popover",
          "@avoid.quest/ui > @base-ui/react/radio",
          "@avoid.quest/ui > @base-ui/react/radio-group",
          "@avoid.quest/ui > @base-ui/react/scroll-area",
          "@avoid.quest/ui > @base-ui/react/select",
          "@avoid.quest/ui > @base-ui/react/separator",
          "@avoid.quest/ui > @base-ui/react/slider",
          "@avoid.quest/ui > @base-ui/react/switch",
          "@avoid.quest/ui > @base-ui/react/tabs",
          "@avoid.quest/ui > @base-ui/react/toggle",
          "@avoid.quest/ui > @base-ui/react/toggle-group",
          "@avoid.quest/ui > @base-ui/react/tooltip",
          "@avoid.quest/ui > @base-ui/react/use-render",
          "@avoid.quest/ui > @tabler/icons-react",
        ],
      },
      plugins: [
        tailwindcss(),
        // Parity with the apps, which compile shared and Radio components.
        babel({ presets: [reactCompilerPreset()] }),
      ],
      resolve: {
        alias: [
          {
            find: RADIO_MODE_LIFECYCLE,
            replacement: `${radioStorybook}/mode-lifecycle-requests.stub.ts`,
          },
          {
            find: RADIO_SERVER_FUNCTIONS,
            replacement: `${radioStorybook}/server-functions.stub.ts`,
          },
          { find: RADIO_ALIAS, replacement: `${radioSrc}/` },
          {
            find: VIRTUAL_CHANGELOG,
            replacement: `${radioStorybook}/changelog.fixture.ts`,
          },
        ],
      },
    });
  },
};

export default config;
