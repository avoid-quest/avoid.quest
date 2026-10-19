import { withThemeByClassName } from "@storybook/addon-themes";
import type { Preview, Renderer } from "@storybook/react-vite";
import { ThemeProvider } from "next-themes";
import "./storybook.css";

const preview: Preview = {
  decorators: [
    withThemeByClassName<Renderer>({
      defaultTheme: "light",
      themes: { dark: "dark", light: "" },
    }),
    (Story, context) => (
      <ThemeProvider
        attribute="class"
        enableSystem={false}
        forcedTheme={context.globals.theme === "dark" ? "dark" : "light"}
      >
        <Story />
      </ThemeProvider>
    ),
  ],
  parameters: {
    a11y: { test: "error" },
    backgrounds: { disable: true },
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
  },
  tags: ["autodocs"],
};

export default preview;
