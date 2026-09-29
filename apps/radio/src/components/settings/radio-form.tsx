// biome-ignore-all lint/performance/noJsxPropsBind: React Compiler stabilizes component handlers
import { Button } from "@avoid.quest/ui/components/button";
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
import { CheckCircleIcon } from "lucide-react";
import { type Control, useController, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { Radio } from "@/lib/audio";
import { updateRadio } from "@/lib/hooks/use-radios";
import type { RadioMetadata } from "@/lib/platform-types";
import { type RadioFormData, radioSchema } from "@/lib/schemas/radio-schema";
import { stationIntake } from "@/lib/stations/external-station-workflow";
import { notifyStationSave } from "@/lib/stations/station-save-notification";
import { RadioFieldPreview } from "./radio-field-preview";

type RadioFormProps = {
  mode: "create" | "edit";
  radio?: Radio;
  onSuccess: () => void;
  onCancel: () => void;
  scrapedData?: RadioMetadata | null;
};

// Extract values from scraped data
const getScrapedValue = (
  scrapedData: RadioMetadata | null,
  field: keyof RadioMetadata,
  fallback = ""
): string => {
  if (!scrapedData?.[field] || scrapedData[field]?.length === 0) {
    return fallback;
  }
  const fieldData = scrapedData[field];
  if (Array.isArray(fieldData) && fieldData.length > 0) {
    const [firstOption] = fieldData;
    if (
      firstOption &&
      typeof firstOption === "object" &&
      "value" in firstOption
    ) {
      return firstOption.value || fallback;
    }
  }
  return fallback;
};

// Track which fields were auto-filled
const getAutoFilledFields = (scrapedData: RadioMetadata | null) => {
  if (!scrapedData) {
    return {};
  }
  return {
    description: Boolean(
      scrapedData.description && scrapedData.description.length > 0
    ),
    logoUrl: Boolean(scrapedData.logoUrl && scrapedData.logoUrl.length > 0),
    name: Boolean(scrapedData.name && scrapedData.name.length > 0),
    streamUrl: Boolean(
      scrapedData.streamUrl && scrapedData.streamUrl.length > 0
    ),
  };
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

const getFormDefaultValues = (
  radio: Radio | undefined,
  scrapedData: RadioMetadata | null | undefined
): RadioFormData => ({
  description:
    radio?.description ?? getScrapedValue(scrapedData ?? null, "description"),
  logoUrl: radio?.logoUrl ?? getScrapedValue(scrapedData ?? null, "logoUrl"),
  name: radio?.name ?? getScrapedValue(scrapedData ?? null, "name"),
  streamUrl:
    radio?.streamUrl ?? getScrapedValue(scrapedData ?? null, "streamUrl"),
  websiteUrl: radio?.websiteUrl ?? scrapedData?.websiteUrl ?? "",
});

type RadioFormFieldName = keyof Pick<
  RadioFormData,
  "description" | "logoUrl" | "name" | "streamUrl" | "websiteUrl"
>;

type RadioFormFieldProps = {
  autoFilled?: boolean;
  control: Control<RadioFormData>;
  label: string;
  multiline?: boolean;
  name: RadioFormFieldName;
  placeholder: string;
};

function RadioFormField({
  autoFilled = false,
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
      <FieldLabel className="flex items-center gap-2" htmlFor={field.name}>
        {label}
        {autoFilled ? (
          <div className="flex items-center gap-1 text-primary text-xs">
            <CheckCircleIcon className="size-3" />
            Auto-filled
          </div>
        ) : null}
      </FieldLabel>
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
  if (isSubmitting) {
    return "Saving…";
  }
  return mode === "create" ? "Create" : "Update";
}

export function RadioForm({
  mode,
  radio,
  onSuccess,
  onCancel,
  scrapedData,
}: RadioFormProps) {
  const form = useForm<RadioFormData>({
    defaultValues: getFormDefaultValues(radio, scrapedData),
    // biome-ignore lint/suspicious/noExplicitAny: Zod 4 type inference workaround
    resolver: zodResolver(radioSchema as any),
  });

  const autoFilledFields = getAutoFilledFields(scrapedData ?? null);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) =>
    form.handleSubmit((data) => handleFormSubmit(data, mode, radio, onSuccess))(
      event
    );
  const watchedName = form.watch("name");
  const watchedLogoUrl = form.watch("logoUrl");
  const watchedStreamUrl = form.watch("streamUrl");
  const showPreviews = mode === "edit" || Boolean(scrapedData);
  const submitLabel = getSubmitLabel(form.formState.isSubmitting, mode);

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <FieldSet>
        <FieldGroup>
          <RadioFormField
            autoFilled={autoFilledFields.name}
            control={form.control}
            label="Name"
            name="name"
            placeholder="Radio station name"
          />

          <RadioFormField
            autoFilled={autoFilledFields.streamUrl}
            control={form.control}
            label="Stream URL"
            name="streamUrl"
            placeholder="https://example.com/stream.mp3"
          />

          <RadioFormField
            autoFilled={autoFilledFields.logoUrl}
            control={form.control}
            label="Logo URL"
            name="logoUrl"
            placeholder="https://example.com/logo.png"
          />

          <RadioFormField
            autoFilled={autoFilledFields.description}
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
      {scrapedData && scrapedData.missingFields.length > 0 ? (
        <div className="space-y-2 border-t pt-4">
          <h4 className="font-medium text-amber-600 text-sm">
            Missing Required Fields
          </h4>
          <p className="text-muted-foreground text-sm">
            The following required fields were not found automatically and need
            to be filled manually:
          </p>
          <ul className="list-inside list-disc space-y-1 text-muted-foreground text-sm">
            {scrapedData.missingFields.map((field) => (
              <li key={field}>
                {field === "streamUrl" && "Stream URL (required)"}
                {field === "name" && "Station Name (required)"}
                {field === "logoUrl" && "Logo URL (optional)"}
                {field === "description" && "Description (optional)"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* URL Previews - Only show in edit mode or when scraped data is available */}
      {showPreviews ? (
        <div className="space-y-3 border-t pt-4">
          <h4 className="font-medium text-sm">Live Previews</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            {watchedLogoUrl ? (
              <div className="space-y-1">
                <div className="font-medium text-muted-foreground text-xs">
                  Logo Preview
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
                  Audio Stream Preview
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

      <div className="flex justify-end gap-2 pt-4">
        <Button onClick={onCancel} type="button" variant="outline">
          Cancel
        </Button>
        <Button disabled={form.formState.isSubmitting} type="submit">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
