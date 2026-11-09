import { Checkbox } from "@avoid.quest/ui/components/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@avoid.quest/ui/components/field";
import { Input } from "@avoid.quest/ui/components/input";
import { Textarea } from "@avoid.quest/ui/components/textarea";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

const meta = {
  component: Field,
  title: "Components/Field",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <FieldGroup className="max-w-sm">
      <Field>
        <FieldLabel htmlFor="station-name">Station name</FieldLabel>
        <Input id="station-name" placeholder="NTS Radio" />
        <FieldDescription>Shown in the station list.</FieldDescription>
      </Field>
      <Field data-invalid>
        <FieldLabel htmlFor="stream-url">Stream URL</FieldLabel>
        <Input aria-invalid defaultValue="not a url" id="stream-url" />
        <FieldError errors={[{ message: "Enter an http(s) URL." }]} />
      </Field>
      <Field>
        <FieldLabel htmlFor="notes">Notes</FieldLabel>
        <Textarea id="notes" placeholder="Anything worth remembering" />
      </Field>
    </FieldGroup>
  ),
};

export const SelectableCard: Story = {
  render: () => (
    <FieldLabel className="max-w-sm">
      <Field orientation="horizontal">
        <Checkbox aria-label="Enable normalization" />
        Normalize station volume
      </Field>
    </FieldLabel>
  ),
  play: async ({ canvasElement }) => {
    const checkbox = within(canvasElement).getByRole("checkbox");
    const card = checkbox.closest("label");
    if (!card) {
      throw new Error("Missing field card label");
    }
    const initialBackground = getComputedStyle(card).backgroundColor;
    await userEvent.click(checkbox);
    await waitFor(() => {
      expect(checkbox).toBeChecked();
      expect(getComputedStyle(card).backgroundColor).not.toBe(
        initialBackground
      );
    });
  },
};
