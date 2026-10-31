import { ScrollArea } from "@avoid.quest/ui/components/scroll-area";
import type { Meta, StoryObj } from "@storybook/react-vite";

const meta = {
  component: ScrollArea,
  title: "Components/ScrollArea",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;
const STATIONS = Array.from({ length: 30 }, (_, i) => `Station ${i + 1}`);

export const Default: Story = {
  parameters: {
    a11y: {
      config: {
        // Radix ScrollArea's viewport is not focusable, so keyboard users cannot scroll it.
        // Known gap, tracked for the Base UI migration; do not copy this exemption elsewhere.
        rules: [{ enabled: false, id: "scrollable-region-focusable" }],
      },
    },
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
