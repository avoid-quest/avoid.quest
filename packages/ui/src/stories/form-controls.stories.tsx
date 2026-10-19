import { Checkbox } from "@avoid.quest/ui/components/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@avoid.quest/ui/components/field";
import { Input } from "@avoid.quest/ui/components/input";
import { Label } from "@avoid.quest/ui/components/label";
import {
  RadioGroup,
  RadioGroupItem,
} from "@avoid.quest/ui/components/radio-group";
import { Switch } from "@avoid.quest/ui/components/switch";
import { Textarea } from "@avoid.quest/ui/components/textarea";
import { Toggle } from "@avoid.quest/ui/components/toggle";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@avoid.quest/ui/components/toggle-group";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

const meta = {
  title: "Primitives/Form controls",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const TextFields: Story = {
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

export const Switches: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = canvas.getByRole("switch", { name: "Disabled state off" });
    await userEvent.click(toggle);
    await expect(toggle).toBeChecked();
  },
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Switch defaultChecked id="sw-on" />
        <Label htmlFor="sw-on">Enabled</Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="sw-off" />
        <Label htmlFor="sw-off">Disabled state off</Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch disabled id="sw-disabled" />
        <Label htmlFor="sw-disabled">Not available</Label>
      </div>
    </div>
  ),
};

export const CheckboxesAndRadios: Story = {
  render: () => (
    <div className="flex gap-12">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Checkbox defaultChecked id="cb-a" />
          <Label htmlFor="cb-a">Show in Single mode</Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="cb-b" />
          <Label htmlFor="cb-b">Show in DJ mode</Label>
        </div>
      </div>
      <RadioGroup defaultValue="system">
        {["system", "light", "dark"].map((value) => (
          <div className="flex items-center gap-2" key={value}>
            <RadioGroupItem id={`rg-${value}`} value={value} />
            <Label className="capitalize" htmlFor={`rg-${value}`}>
              {value}
            </Label>
          </div>
        ))}
      </RadioGroup>
    </div>
  ),
};

export const Toggles: Story = {
  render: () => (
    <div className="flex items-center gap-6">
      <Toggle aria-label="Mute">Mute</Toggle>
      <ToggleGroup defaultValue="single" type="single">
        <ToggleGroupItem value="single">Single</ToggleGroupItem>
        <ToggleGroupItem value="node">Node</ToggleGroupItem>
        <ToggleGroupItem value="dj">DJ</ToggleGroupItem>
      </ToggleGroup>
    </div>
  ),
};
