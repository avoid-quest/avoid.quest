import {
  afterEach,
  decorators,
  initialGlobals,
  parameters,
} from "@storybook/addon-a11y/preview";
import { initialGlobals as themeGlobals } from "@storybook/addon-themes/preview";
import { setProjectAnnotations } from "@storybook/react-vite";
import previewAnnotations from "./preview";

// Keep the stylesheet, theme decorators, and axe hooks in both Vitest projects.
setProjectAnnotations([
  { afterEach, decorators, initialGlobals, parameters },
  { initialGlobals: themeGlobals },
  previewAnnotations,
]);
