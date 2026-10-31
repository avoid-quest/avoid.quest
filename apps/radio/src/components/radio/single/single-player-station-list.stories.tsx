import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { SearchField } from "@/components/radio/search-field";
import { StationList } from "@/components/radio/single/single-player-station-list";
import { withRadioQueryClient } from "@/storybook/decorators";
import { FIXTURE_STATION, FIXTURE_STATIONS } from "@/storybook/fixtures";

const KIEZ_RADIO = /^Kiez Radio/;
const HARBOUR_FM = /^Harbour FM/;

const meta = {
  args: {
    currentRadioId: undefined,
    isPlaying: false,
    onDelete: fn(),
    onEdit: fn(),
    onSave: fn(),
    onSelect: fn(),
    onToggle: fn(),
    onTogglePlayPause: fn(),
    radios: FIXTURE_STATIONS,
    searchBar: <SearchField />,
    sessionRadios: [],
  },
  component: StationList,
  decorators: [
    (Story) => (
      <div className="flex h-96 w-80 rounded-lg border">
        <Story />
      </div>
    ),
    withRadioQueryClient,
  ],
  parameters: {
    controls: { exclude: ["radios", "searchBar", "sessionRadios"] },
  },
  title: "Radio/Features/StationList",
} satisfies Meta<typeof StationList>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("searchbox", { name: "Search stations" })
    ).toBeVisible();
    await expect(canvas.getByText("London, United Kingdom")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: KIEZ_RADIO }));
    await expect(args.onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "storybook-station-kiez" })
    );
  },
};

/** The current station is marked, and selecting it again pauses. */
export const Playing: Story = {
  args: { currentRadioId: FIXTURE_STATION.id, isPlaying: true },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const current = canvas.getByRole("button", { name: HARBOUR_FM });
    await expect(current).toHaveAttribute("aria-current", "true");
    await expect(canvas.getByRole("img", { name: "Playing" })).toBeVisible();
    await userEvent.click(current);
    await expect(args.onTogglePlayPause).toHaveBeenCalledOnce();
    await expect(args.onSelect).not.toHaveBeenCalled();
  },
};

export const Empty: Story = {
  args: { radios: [] },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText("Search to add a station")
    ).toBeVisible();
  },
};

export const OpenMenuKeepsActionsVisible: Story = {
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("button", {
      name: `Options for ${FIXTURE_STATION.name}`,
    });
    const actions = trigger.parentElement;
    const row = trigger.closest(".group");
    if (!(actions && row)) {
      throw new Error("Missing station row actions");
    }
    await userEvent.hover(row);
    await userEvent.click(trigger);
    const menu = await within(document.body).findByRole("menu");
    await userEvent.unhover(row);
    await userEvent.hover(menu);
    await waitFor(() => {
      expect(getComputedStyle(actions).opacity).toBe("1");
      expect(getComputedStyle(row).backgroundColor).not.toBe(
        "rgba(0, 0, 0, 0)"
      );
    });
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(within(document.body).queryByRole("menu")).toBeNull()
    );
  },
};
