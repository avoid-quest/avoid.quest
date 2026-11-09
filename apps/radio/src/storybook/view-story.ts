import type { Meta } from "@storybook/react-vite";
import {
  seedRadioSettings,
  withAppFrame,
  withRadioQueryClient,
  withRadioRouter,
} from "./decorators";

/** Shared setup for Radio/Views stories: a page inside the real app frame. */
export const viewStoryDefaults = {
  beforeEach: () => seedRadioSettings(),
  decorators: [withAppFrame, withRadioRouter, withRadioQueryClient],
  parameters: {
    docs: { story: { height: "560px", inline: false } },
    layout: "fullscreen",
  },
} satisfies Partial<Meta>;
