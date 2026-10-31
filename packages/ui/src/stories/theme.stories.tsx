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

function normalizeColor(color: string) {
  const { style } = document.createElement("div");
  style.color = color;
  return style.color;
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
    const expectedBackground =
      globals.theme === "dark"
        ? "oklch(0.141 0.005 285.823)"
        : "oklch(0.99 0.002 285.823)";
    // Normalize equivalent CSS color serializations, including minified values.
    await expect(
      normalizeColor(
        getComputedStyle(document.documentElement)
          .getPropertyValue("--background")
          .trim()
      )
    ).toBe(normalizeColor(expectedBackground));
    await expect(getComputedStyle(document.body).backgroundColor).not.toBe(
      "rgba(0, 0, 0, 0)"
    );
  },
  render: () => <ThemeStatus />,
};
