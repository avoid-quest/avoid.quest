// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
import { Button } from "@avoid.quest/ui/components/button";
import { DialogFooter } from "@avoid.quest/ui/components/dialog";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@avoid.quest/ui/components/field";
import { Input } from "@avoid.quest/ui/components/input";
import { Textarea } from "@avoid.quest/ui/components/textarea";
import { zodResolver } from "@hookform/resolvers/zod";
import { type Control, useController, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { Radio } from "@/lib/audio";
import { updateRadio } from "@/lib/hooks/use-radios";
import { type RadioFormData, radioSchema } from "@/lib/schemas/radio-schema";
import { stationIntake } from "@/lib/stations/external-station-workflow";
import { notifyStationSave } from "@/lib/stations/station-save-notification";
import { RadioFieldPreview } from "./radio-field-preview";

type RadioFormProps = {
  mode: "create" | "edit";
  radio?: Radio;
  onSuccess: () => void;
  onCancel: () => void;
};

const handleFormSubmit = async (
  data: RadioFormData,
  mode: "create" | "edit",
  radio: Radio | undefined,
  onSuccess: () => void
) => {
  try {
    if (mode === "create") {
      const result = await stationIntake.save({
        fields: data,
        origin: "manual",
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      notifyStationSave(result.data, `Added "${data.name}"`);
    } else if (mode === "edit" && radio?.id) {
      // An edited default station is the user's now; sync must not revert it.
      updateRadio(String(radio.id), { ...data, isSystem: false });
      toast.success(`Saved "${data.name}"`);
    }
    onSuccess();
  } catch {
    toast.error(
      mode === "create" ? "Couldn't add station" : "Couldn't save station"
    );
  }
};

const getFormDefaultValues = (radio: Radio | undefined): RadioFormData => ({
  description: radio?.description ?? "",
  logoUrl: radio?.logoUrl ?? "",
  name: radio?.name ?? "",
  streamUrl: radio?.streamUrl ?? "",
  websiteUrl: radio?.websiteUrl ?? "",
});

type RadioFormFieldName = keyof Pick<
  RadioFormData,
  "description" | "logoUrl" | "name" | "streamUrl" | "websiteUrl"
>;

type RadioFormFieldProps = {
  control: Control<RadioFormData>;
  label: string;
  multiline?: boolean;
  name: RadioFormFieldName;
  placeholder: string;
};

function RadioFormField({
  control,
  label,
  multiline = false,
  name,
  placeholder,
}: RadioFormFieldProps) {
  const { field, fieldState } = useController({ control, name });
  const inputProps = {
    "aria-invalid": fieldState.invalid,
    id: field.name,
    placeholder,
    ...field,
  };

  return (
    <Field data-invalid={fieldState.invalid}>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      {multiline ? (
        <Textarea className="min-h-20" {...inputProps} />
      ) : (
        <Input {...inputProps} />
      )}
      {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
    </Field>
  );
}

function getSubmitLabel(isSubmitting: boolean, mode: "create" | "edit") {
  if (mode === "create") {
    return isSubmitting ? "Adding…" : "Add station";
  }
  return isSubmitting ? "Saving…" : "Save";
}

export function RadioForm({
  mode,
  radio,
  onSuccess,
  onCancel,
}: RadioFormProps) {
  const form = useForm<RadioFormData>({
    defaultValues: getFormDefaultValues(radio),
    // biome-ignore lint/suspicious/noExplicitAny: Zod 4 type inference workaround
    resolver: zodResolver(radioSchema as any),
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) =>
    form.handleSubmit((data) => handleFormSubmit(data, mode, radio, onSuccess))(
      event
    );
  const watchedName = form.watch("name");
  const watchedLogoUrl = form.watch("logoUrl");
  const watchedStreamUrl = form.watch("streamUrl");
  const showPreviews = mode === "edit";
  const submitLabel = getSubmitLabel(form.formState.isSubmitting, mode);

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <FieldSet>
        <FieldGroup>
          <RadioFormField
            control={form.control}
            label="Name"
            name="name"
            placeholder="Radio station name"
          />

          <RadioFormField
            control={form.control}
            label="Stream URL"
            name="streamUrl"
            placeholder="https://example.com/stream.mp3"
          />

          <RadioFormField
            control={form.control}
            label="Logo URL"
            name="logoUrl"
            placeholder="https://example.com/logo.png"
          />

          <RadioFormField
            control={form.control}
            label="Description"
            multiline
            name="description"
            placeholder="Radio station description"
          />

          <RadioFormField
            control={form.control}
            label="Website URL"
            name="websiteUrl"
            placeholder="https://example.com"
          />
        </FieldGroup>
      </FieldSet>
      {showPreviews ? (
        <div className="space-y-3 border-t pt-4">
          <h4 className="font-medium text-sm">Preview</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            {watchedLogoUrl ? (
              <div className="space-y-1">
                <div className="font-medium text-muted-foreground text-xs">
                  Logo
                </div>
                <RadioFieldPreview
                  field="logoUrl"
                  radioName={watchedName || radio?.name || "Radio"}
                  value={watchedLogoUrl}
                />
              </div>
            ) : null}

            {watchedStreamUrl ? (
              <div className="space-y-1">
                <div className="font-medium text-muted-foreground text-xs">
                  Stream
                </div>
                <RadioFieldPreview
                  field="streamUrl"
                  radioName={watchedName || radio?.name || "Radio"}
                  value={watchedStreamUrl}
                />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <DialogFooter>
        <Button onClick={onCancel} size="sm" type="button" variant="outline">
          Cancel
        </Button>
        <Button disabled={form.formState.isSubmitting} size="sm" type="submit">
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
