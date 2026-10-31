import { Badge } from "@avoid.quest/ui/components/badge";
import { Button } from "@avoid.quest/ui/components/button";
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
      globals.theme === "dark" ? "oklch(0.141 0.005 285.823)" : "oklch(1 0 0)";
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
    await expect(getComputedStyle(document.body).fontFamily).toContain(
      "Geist Mono Variable"
    );
    await expect(
      await document.fonts.load('400 16px "Geist Mono Variable"')
    ).not.toHaveLength(0);
  },
  render: () => <ThemeStatus />,
};

/** Each state exposes both a foreground-on-surface use and its solid pair. */
export const StateColours: Story = {
  render: () => (
    <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
      <div className="space-y-2 rounded-md border p-4">
        <p className="font-medium text-success">Success</p>
        <p className="rounded-md bg-success p-3 text-sm text-success-foreground">
          Your stations have been saved.
        </p>
      </div>
      <div className="space-y-2 rounded-md border p-4">
        <p className="font-medium text-warning">Warning</p>
        <p className="rounded-md bg-warning p-3 text-sm text-warning-foreground">
          Your input is close to clipping.
        </p>
      </div>
      <div className="space-y-2 rounded-md border p-4">
        <p className="font-medium text-info">Info</p>
        <p className="rounded-md bg-info p-3 text-info-foreground text-sm">
          Connect an audio source to get started.
        </p>
      </div>
      <div className="space-y-2 rounded-md border p-4">
        <p className="font-medium text-destructive">Destructive</p>
        <p className="rounded-md bg-destructive p-3 text-destructive-foreground text-sm">
          The station could not be loaded.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="destructive">Delete station</Button>
          <Badge variant="destructive">Unavailable</Badge>
        </div>
      </div>
    </div>
  ),
};
