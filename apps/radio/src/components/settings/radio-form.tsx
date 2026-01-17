import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@workspace/ui/components/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { Textarea } from "@workspace/ui/components/textarea";
import { CheckCircleIcon } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { Radio } from "@/lib/audio";
import { radiosCollection } from "@/lib/collections";
import { addRadio, updateRadio } from "@/lib/hooks/use-radios";
import type { RadioMetadata } from "@/lib/platform-types";
import { type RadioFormData, radioSchema } from "@/lib/schemas/radio-schema";
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
    const firstOption = fieldData[0];
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
    name: scrapedData.name && scrapedData.name.length > 0,
    streamUrl: scrapedData.streamUrl && scrapedData.streamUrl.length > 0,
    logoUrl: scrapedData.logoUrl && scrapedData.logoUrl.length > 0,
    description: scrapedData.description && scrapedData.description.length > 0,
  };
};

const handleFormSubmit = (
  data: RadioFormData,
  mode: "create" | "edit",
  radio: Radio | undefined,
  onSuccess: () => void
) => {
  try {
    if (mode === "create") {
      // Get the maximum order value and add 1 for the new radio
      const existingRadios = Array.from(radiosCollection.state.values());
      const maxOrder = Math.max(...existingRadios.map((r) => r.order || 0), 0);

      addRadio({
        ...data,
        order: maxOrder + 1,
        enabled: true,
      });
      toast.success("Radio station created successfully");
    } else if (mode === "edit" && radio?.id) {
      updateRadio(String(radio.id), data);
      toast.success("Radio station updated successfully");
    }
    onSuccess();
  } catch (error) {
    console.error("Failed to save radio:", error);
    toast.error(`Failed to ${mode} radio station`);
  }
};

const getFormDefaultValues = (
  radio: Radio | undefined,
  scrapedData: RadioMetadata | null | undefined
): RadioFormData => ({
  name: radio?.name ?? getScrapedValue(scrapedData ?? null, "name"),
  streamUrl:
    radio?.streamUrl ?? getScrapedValue(scrapedData ?? null, "streamUrl"),
  logoUrl: radio?.logoUrl ?? getScrapedValue(scrapedData ?? null, "logoUrl"),
  description:
    radio?.description ?? getScrapedValue(scrapedData ?? null, "description"),
  websiteUrl: radio?.websiteUrl ?? scrapedData?.websiteUrl ?? "",
});

export function RadioForm({
  mode,
  radio,
  onSuccess,
  onCancel,
  scrapedData,
}: RadioFormProps) {
  const form = useForm<RadioFormData>({
    // biome-ignore lint/suspicious/noExplicitAny: Zod 4 type inference workaround
    resolver: zodResolver(radioSchema as any),
    defaultValues: getFormDefaultValues(radio, scrapedData),
  });

  const autoFilledFields = getAutoFilledFields(scrapedData ?? null);

  const onSubmit = (data: RadioFormData) => {
    handleFormSubmit(data, mode, radio, onSuccess);
  };

  return (
    <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
      <FieldSet>
        <FieldGroup>
          <Controller
            control={form.control}
            name="name"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel
                  className="flex items-center gap-2"
                  htmlFor={field.name}
                >
                  Name
                  {autoFilledFields.name?.valueOf() && (
                    <div className="flex items-center gap-1 text-primary text-xs">
                      <CheckCircleIcon className="size-3" />
                      Auto-filled
                    </div>
                  )}
                </FieldLabel>
                <Input
                  aria-invalid={fieldState.invalid}
                  id={field.name}
                  placeholder="Radio station name"
                  {...field}
                />
                {fieldState.invalid.valueOf() && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </Field>
            )}
          />

          <Controller
            control={form.control}
            name="streamUrl"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel
                  className="flex items-center gap-2"
                  htmlFor={field.name}
                >
                  Stream URL
                  {autoFilledFields.streamUrl?.valueOf() && (
                    <div className="flex items-center gap-1 text-primary text-xs">
                      <CheckCircleIcon className="size-3" />
                      Auto-filled
                    </div>
                  )}
                </FieldLabel>
                <Input
                  aria-invalid={fieldState.invalid}
                  id={field.name}
                  placeholder="https://example.com/stream.mp3"
                  {...field}
                />
                {fieldState.invalid.valueOf() && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </Field>
            )}
          />

          <Controller
            control={form.control}
            name="logoUrl"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel
                  className="flex items-center gap-2"
                  htmlFor={field.name}
                >
                  Logo URL
                  {autoFilledFields.logoUrl?.valueOf() && (
                    <div className="flex items-center gap-1 text-primary text-xs">
                      <CheckCircleIcon className="size-3" />
                      Auto-filled
                    </div>
                  )}
                </FieldLabel>
                <Input
                  aria-invalid={fieldState.invalid}
                  id={field.name}
                  placeholder="https://example.com/logo.png"
                  {...field}
                />
                {fieldState.invalid.valueOf() && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </Field>
            )}
          />

          <Controller
            control={form.control}
            name="description"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel
                  className="flex items-center gap-2"
                  htmlFor={field.name}
                >
                  Description
                  {autoFilledFields.description?.valueOf() && (
                    <div className="flex items-center gap-1 text-primary text-xs">
                      <CheckCircleIcon className="size-3" />
                      Auto-filled
                    </div>
                  )}
                </FieldLabel>
                <Textarea
                  aria-invalid={fieldState.invalid}
                  className="min-h-20"
                  id={field.name}
                  placeholder="Radio station description"
                  {...field}
                />
                {fieldState.invalid.valueOf() && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </Field>
            )}
          />

          <Controller
            control={form.control}
            name="websiteUrl"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={field.name}>Website URL</FieldLabel>
                <Input
                  aria-invalid={fieldState.invalid}
                  id={field.name}
                  placeholder="https://example.com"
                  {...field}
                />
                {fieldState.invalid.valueOf() && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </Field>
            )}
          />
        </FieldGroup>
      </FieldSet>
      {scrapedData?.valueOf() && scrapedData.missingFields.length > 0 && (
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
      )}

      {/* URL Previews - Only show in edit mode or when scraped data is available */}
      {(mode === "edit" || scrapedData) && (
        <div className="space-y-3 border-t pt-4">
          <h4 className="font-medium text-sm">Live Previews</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            {form.watch("logoUrl") && (
              <div className="space-y-1">
                <div className="font-medium text-muted-foreground text-xs">
                  Logo Preview
                </div>
                <RadioFieldPreview
                  field="logoUrl"
                  radioName={form.watch("name") || radio?.name || "Radio"}
                  value={form.watch("logoUrl") || ""}
                />
              </div>
            )}

            {form.watch("streamUrl") && (
              <div className="space-y-1">
                <div className="font-medium text-muted-foreground text-xs">
                  Audio Stream Preview
                </div>
                <RadioFieldPreview
                  field="streamUrl"
                  radioName={form.watch("name") || radio?.name || "Radio"}
                  value={form.watch("streamUrl") || ""}
                />
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-4">
        <Button onClick={onCancel} type="button" variant="outline">
          Cancel
        </Button>
        <Button disabled={form.formState.isSubmitting} type="submit">
          {(() => {
            if (form.formState.isSubmitting) {
              return "Saving...";
            }
            return mode === "create" ? "Create" : "Update";
          })()}
        </Button>
      </div>
    </form>
  );
}
