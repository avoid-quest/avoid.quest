import type { Meta, StoryObj } from "@storybook/react-vite";
import { useTheme } from "next-themes";
import { expect, waitFor, within } from "storybook/test";

const meta = {
  title: "Foundations/Theme",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function ThemeStatus() {
  const { forcedTheme } = useTheme();
  return <output>Theme: {forcedTheme}</output>;
}

export const Applied: Story = {
  play: async ({ canvasElement, globals, parameters }) => {
    await expect(["light", "dark"]).toContain(globals.theme);
    await expect(parameters.a11y.test).toBe("error");
    await expect(within(canvasElement).getByRole("status")).toHaveTextContent(
      `Theme: ${globals.theme}`
    );
    await waitFor(() =>
      expect(document.documentElement.classList.contains("dark")).toBe(
        globals.theme === "dark"
      )
    );
    // These are supplied by the preview stylesheet, not browser defaults.
    await expect(
      getComputedStyle(document.documentElement)
        .getPropertyValue("--background")
        .trim()
    ).not.toBe("");
    await expect(getComputedStyle(document.body).backgroundColor).not.toBe(
      "rgba(0, 0, 0, 0)"
    );
  },
  render: () => <ThemeStatus />,
};
