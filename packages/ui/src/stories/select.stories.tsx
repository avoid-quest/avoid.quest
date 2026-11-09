import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@avoid.quest/ui/components/select";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

const DEVICES = ["System default", "Built-in output", "USB interface"];

function DeviceSelect({ size }: { size?: "xs" | "sm" | "default" }) {
  return (
    <Select>
      <SelectTrigger aria-label="Output device" className="w-56" size={size}>
        <SelectValue placeholder="Choose an output" />
      </SelectTrigger>
      {/* The list has a distinct accessible name from its trigger. */}
      <SelectContent aria-label="Output devices">
        {DEVICES.map((device) => (
          <SelectItem key={device} value={device}>
            {device}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const meta = {
  component: DeviceSelect,
  title: "Components/Select",
} satisfies Meta<typeof DeviceSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Sizes: Story = {
  play: async ({ canvasElement }) => {
    const triggers = within(canvasElement).getAllByRole("combobox");
    await expect(
      triggers.map((trigger) => getComputedStyle(trigger).height)
    ).toEqual(["28px", "36px", "40px"]);
  },
  render: () => (
    <div className="flex flex-col gap-3">
      <DeviceSelect size="xs" />
      <DeviceSelect size="sm" />
      <DeviceSelect />
    </div>
  ),
};

export const Selected: Story = {
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("combobox", {
      name: "Output device",
    });
    await userEvent.click(trigger);
    const option = await within(document.body).findByRole("option", {
      name: "USB interface",
    });
    await userEvent.click(option);
    await expect(trigger).toHaveTextContent("USB interface");
    // Let the close animation and aria-hidden cleanup finish before axe runs.
    await waitFor(() =>
      expect(within(document.body).queryByRole("listbox")).toBeNull()
    );
  },
};

export const InitialSelectionLabel: Story = {
  render: () => (
    <Select
      defaultValue="usb-interface"
      items={{ "usb-interface": "USB interface" }}
    >
      <SelectTrigger aria-label="Initial output device" size="xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="usb-interface">USB interface</SelectItem>
      </SelectContent>
    </Select>
  ),
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("combobox", {
        name: "Initial output device",
      })
    ).toHaveTextContent("USB interface");
  },
};
