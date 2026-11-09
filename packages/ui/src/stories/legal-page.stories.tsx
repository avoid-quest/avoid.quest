import { LegalPage } from "@avoid.quest/ui/components/legal-page";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

const meta = {
  component: LegalPage,
  title: "Components/LegalPage",
} satisfies Meta<typeof LegalPage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "Source and licenses" })
    ).toBeVisible();
    await expect(
      canvas.queryByRole("link", { name: "Download this version’s source" })
    ).toBeNull();
  },
};

export const WithSourceArchive: Story = {
  args: { sourceRevision: "c833a76ac4a4eb0f8a97dfa7070a8c55c7475eee" },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("link", { name: "Download this version’s source" })
    ).toHaveAttribute("href", "/legal/source.tar.gz");
    await expect(
      canvas.getByRole("link", { name: "c833a76a" })
    ).toHaveAttribute(
      "href",
      `https://github.com/avoid-quest/avoid.quest/tree/${args.sourceRevision}`
    );
  },
};
