import { Changelog } from "@avoid.quest/ui/components/changelog";
import { TooltipProvider } from "@avoid.quest/ui/components/tooltip";
import type { ChangelogEntry } from "@avoid.quest/ui/lib/changelog";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

const STORAGE_KEY = "storybook-changelog-seen";
const ENTRIES: ChangelogEntry[] = [
  {
    date: "2026-09-20T12:00:00Z",
    id: "node",
    text: "Explore stations in Node mode",
  },
  {
    date: "2026-09-07T12:00:00Z",
    id: "preview",
    text: "Preview the current track",
  },
];

const meta = {
  args: { entries: ENTRIES, footer: "Radio 0.7.2", storageKey: STORAGE_KEY },
  beforeEach: () => {
    const previous = localStorage.getItem(STORAGE_KEY);
    localStorage.setItem(STORAGE_KEY, "2026-09-10T00:00:00Z");
    return () => {
      if (previous === null) {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, previous);
      }
    };
  },
  component: Changelog,
  decorators: [
    (Story) => (
      <TooltipProvider>
        <Story />
      </TooltipProvider>
    ),
  ],
  title: "Components/Changelog",
} satisfies Meta<typeof Changelog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Unread: Story = {
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("button", {
      name: "What's new (unread)",
    });
    await userEvent.click(trigger);
    const body = within(document.body);
    await expect(
      await body.findByText("Explore stations in Node mode")
    ).toHaveTextContent("New: Explore stations in Node mode");
    await expect(
      body.getByText("Preview the current track")
    ).not.toHaveTextContent("New:");
    await expect(localStorage.getItem(STORAGE_KEY)).toBe(ENTRIES[0]?.date);
    await expect(trigger).toHaveAccessibleName("What's new");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    await waitFor(() => expect(body.queryByRole("dialog")).toBeNull());
    // On reopening, the list has no new-entry flags.
    await userEvent.click(trigger);
    await expect(
      await body.findByText("Explore stations in Node mode")
    ).not.toHaveTextContent("New:");
  },
};

export const FirstVisit: Story = {
  beforeEach: () => {
    localStorage.removeItem(STORAGE_KEY);
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "What's new (unread)" })
    );
    await expect(
      await within(document.body).findByText("Explore stations in Node mode")
    ).not.toHaveTextContent("New:");
  },
};

export const UpToDate: Story = {
  beforeEach: () => {
    localStorage.setItem(STORAGE_KEY, "2026-09-30T00:00:00Z");
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "What's new" })
    );
    await expect(
      await within(document.body).findByText("Explore stations in Node mode")
    ).not.toHaveTextContent("New:");
    await expect(localStorage.getItem(STORAGE_KEY)).toBe(
      "2026-09-30T00:00:00Z"
    );
  },
};

export const Empty: Story = {
  args: { entries: [] },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "What's new" })
    );
    const message = await within(document.body).findByText("Nothing new yet.");
    await waitFor(() => expect(message).toBeVisible());
  },
};
