import { ScrollArea } from "@avoid.quest/ui/components/scroll-area";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";

const meta = {
  component: ScrollArea,
  title: "Components/ScrollArea",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;
const STATIONS = Array.from({ length: 30 }, (_, i) => `Station ${i + 1}`);

export const Default: Story = {
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const thumb = canvasElement.querySelector(
        '[data-slot="scroll-area-thumb"]'
      );
      if (!thumb) {
        throw new Error("Missing scroll thumb");
      }
      const bounds = thumb.getBoundingClientRect();
      expect(bounds.width).toBeGreaterThan(0);
      expect(bounds.height).toBeGreaterThan(0);
    });
  },
  render: () => (
    <ScrollArea className="h-40 w-64 rounded-md border">
      <ul className="p-3 text-sm">
        {STATIONS.map((station) => (
          <li className="py-1" key={station}>
            {station}
          </li>
        ))}
      </ul>
    </ScrollArea>
  ),
};

export const ConstrainedContent: Story = {
  render: () => (
    <ScrollArea className="h-40 w-64 border [&_[data-slot=scroll-area-content]]:min-w-0!">
      <p className="truncate p-3">{"Long station metadata ".repeat(30)}</p>
    </ScrollArea>
  ),
  play: async ({ canvasElement }) => {
    const viewport = canvasElement.querySelector(
      '[data-slot="scroll-area-viewport"]'
    );
    const content = canvasElement.querySelector(
      '[data-slot="scroll-area-content"]'
    );
    if (!(viewport && content)) {
      throw new Error("Missing scroll area structure");
    }
    await waitFor(() =>
      expect(content.getBoundingClientRect().width).toBeLessThanOrEqual(
        viewport.getBoundingClientRect().width
      )
    );
  },
};
