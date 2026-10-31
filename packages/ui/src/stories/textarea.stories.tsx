import { Label } from "@avoid.quest/ui/components/label";
import { Textarea } from "@avoid.quest/ui/components/textarea";
import type { Meta, StoryObj } from "@storybook/react-vite";

const meta = {
  component: Textarea,
  title: "Components/Textarea",
} satisfies Meta<typeof Textarea>;
export default meta;
type Story = StoryObj<typeof meta>;

export const States: Story = {
  render: () => (
    <div className="grid max-w-sm gap-3">
      <Label htmlFor="textarea-notes">Notes</Label>
      <Textarea id="textarea-notes" placeholder="Anything worth remembering" />
      <Label htmlFor="textarea-disabled">Saved notes</Label>
      <Textarea
        defaultValue="Independent radio from London."
        disabled
        id="textarea-disabled"
      />
    </div>
  ),
};
