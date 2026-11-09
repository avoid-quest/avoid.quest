import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@avoid.quest/ui/components/resizable";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

const meta = {
  component: ResizablePanelGroup,
  parameters: { controls: { include: ["disabled", "orientation"] } },
  subcomponents: { ResizableHandle, ResizablePanel },
  title: "Components/Resizable",
} satisfies Meta<typeof ResizablePanelGroup>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Horizontal: Story = {
  args: { orientation: "horizontal" },
  play: async ({ canvasElement }) => {
    const handle = within(canvasElement).getByRole("separator", {
      name: "Resize station panels",
    });
    const initial = Number(handle.getAttribute("aria-valuenow"));
    handle.focus();
    await userEvent.keyboard("{ArrowRight}");
    await waitFor(() =>
      expect(Number(handle.getAttribute("aria-valuenow"))).toBeGreaterThan(
        initial
      )
    );
    await userEvent.keyboard("{ArrowLeft}");
    await waitFor(() =>
      expect(Number(handle.getAttribute("aria-valuenow"))).toBe(initial)
    );
  },
  render: (args) => (
    <ResizablePanelGroup
      {...args}
      className="min-h-48 max-w-xl rounded-md border"
    >
      <ResizablePanel defaultSize="35%" id="stations" minSize="20%">
        <div className="p-6 text-sm">Stations</div>
      </ResizablePanel>
      <ResizableHandle aria-label="Resize station panels" withHandle />
      <ResizablePanel defaultSize="65%" id="player" minSize="20%">
        <div className="p-6 text-sm">Now playing</div>
      </ResizablePanel>
    </ResizablePanelGroup>
  ),
};

export const Vertical: Story = {
  args: { orientation: "vertical" },
  play: async ({ canvasElement }) => {
    const handle = within(canvasElement).getByRole("separator", {
      name: "Resize mixer panels",
    });
    const initial = Number(handle.getAttribute("aria-valuenow"));
    handle.focus();
    await userEvent.keyboard("{ArrowDown}");
    await waitFor(() =>
      expect(Number(handle.getAttribute("aria-valuenow"))).toBeGreaterThan(
        initial
      )
    );
  },
  render: (args) => (
    <div className="h-72 max-w-xl">
      <ResizablePanelGroup {...args} className="rounded-md border">
        <ResizablePanel defaultSize="60%" id="deck" minSize="20%">
          <div className="p-6 text-sm">Deck</div>
        </ResizablePanel>
        <ResizableHandle aria-label="Resize mixer panels" withHandle />
        <ResizablePanel defaultSize="40%" id="mixer" minSize="20%">
          <div className="p-6 text-sm">Mixer</div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  ),
};
