import type { RadioMetadata, ScrapedOption } from "@avoid.quest/radio-shared";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
  RadioGroup,
  RadioGroupItem,
} from "@workspace/ui/components/radio-group";
import { Textarea } from "@workspace/ui/components/textarea";
import { Volume2Icon } from "lucide-react";
import { useState } from "react";

type RadioScrapedResultsProps = {
  data: RadioMetadata;
  onContinue: (data: RadioMetadata) => void;
  onTryAgain: () => void;
};

export function RadioScrapedResults({
  data,
  onContinue,
  onTryAgain,
}: RadioScrapedResultsProps) {
  const [selectedOptions, setSelectedOptions] = useState<{
    name?: string;
    streamUrl?: string;
    logoUrl?: string;
    description?: string;
  }>({});

  const [customValues, setCustomValues] = useState<{
    name?: string;
    description?: string;
  }>({});

  const handleOptionSelect = (
    field: keyof typeof selectedOptions,
    value: string
  ) => {
    setSelectedOptions((prev) => ({ ...prev, [field]: value }));
  };

  const handleCustomValueChange = (
    field: keyof typeof customValues,
    value: string
  ) => {
    setCustomValues((prev) => ({ ...prev, [field]: value }));
  };

  const handleContinue = () => {
    const finalData: RadioMetadata = {
      ...data,
      name:
        selectedOptions.name || customValues.name
          ? [
              {
                value: selectedOptions.name || customValues.name || "",
                label: "Selected",
                confidence: 1,
              },
            ]
          : data.name,
      streamUrl: selectedOptions.streamUrl
        ? [
            {
              value: selectedOptions.streamUrl,
              label: "Selected",
              confidence: 1,
            },
          ]
        : data.streamUrl,
      logoUrl: selectedOptions.logoUrl
        ? [
            {
              value: selectedOptions.logoUrl,
              label: "Selected",
              confidence: 1,
            },
          ]
        : data.logoUrl,
      description:
        selectedOptions.description || customValues.description
          ? [
              {
                value:
                  selectedOptions.description || customValues.description || "",
                label: "Selected",
                confidence: 1,
              },
            ]
          : data.description,
    };

    onContinue(finalData);
  };

  const renderOptionItem = (
    option: ScrapedOption,
    field: string,
    isSelected: boolean
  ) => {
    return (
      <div
        className={`flex items-center gap-3 rounded border p-2 transition-colors ${
          isSelected
            ? "border-primary bg-primary/5"
            : "border-border hover:bg-muted/50"
        }`}
        key={option.value}
      >
        <RadioGroupItem
          className="mt-0"
          id={`${field}-${option.value}`}
          value={option.value}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <Label
              className="wrap-break-words cursor-pointer font-medium"
              htmlFor={`${field}-${option.value}`}
            >
              {option.label}
            </Label>
            <div className="flex shrink-0 items-center gap-2">
              {option.preview?.trim() !== "" && field === "logoUrl" && (
                <div className="group relative">
                  <button
                    className="flex h-10 w-10 items-center justify-center rounded border bg-muted/50 transition-colors hover:bg-muted/80"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.open(option.preview, "_blank");
                    }}
                    type="button"
                  >
                    <img
                      alt="Logo preview"
                      className="max-h-8 max-w-8 object-contain"
                      height={32}
                      src={option.preview}
                      width={32}
                    />
                  </button>
                  {/* Hover preview */}
                  <div className="absolute -top-2 -right-2 z-10 hidden rounded-lg border bg-background p-2 shadow-lg group-hover:block">
                    <img
                      alt="Logo preview large"
                      className="h-16 w-16 object-contain"
                      height={64}
                      src={option.preview}
                      width={64}
                    />
                  </div>
                </div>
              )}
              {field === "streamUrl" && (
                <Button
                  className="h-8 px-3"
                  onClick={(e) => {
                    e.stopPropagation();
                    // Test stream functionality
                  }}
                  size="sm"
                  variant="outline"
                >
                  <Volume2Icon className="mr-1 size-3" />
                  Test
                </Button>
              )}
            </div>
          </div>
          <p
            className={`mt-1 text-muted-foreground text-xs ${
              field === "streamUrl" ? "break-all" : "wrap-break-words"
            }`}
          >
            {option.value}
          </p>
        </div>
      </div>
    );
  };

  const renderFieldSection = (
    field: keyof typeof selectedOptions,
    fieldLabel: string,
    options: ScrapedOption[] | undefined,
    hasCustomInput = false
  ) => {
    if (!options || options.length === 0) {
      return null;
    }

    const selectedValue = selectedOptions[field];
    const customValue = customValues[field as keyof typeof customValues];

    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="font-medium text-sm">{fieldLabel}</Label>
          {hasCustomInput.valueOf() && (
            <div className="flex items-center gap-2">
              <Label className="text-muted-foreground text-xs">Custom:</Label>
              {field === "name" ? (
                <Input
                  className="h-8 w-48"
                  onChange={(e) =>
                    handleCustomValueChange(
                      field as keyof typeof customValues,
                      e.target.value
                    )
                  }
                  placeholder={`Enter ${fieldLabel.toLowerCase()}`}
                  value={customValue || ""}
                />
              ) : (
                <Textarea
                  className="h-8 w-48 resize-none"
                  onChange={(e) =>
                    handleCustomValueChange(
                      field as keyof typeof customValues,
                      e.target.value
                    )
                  }
                  placeholder={`Enter ${fieldLabel.toLowerCase()}`}
                  value={customValue || ""}
                />
              )}
            </div>
          )}
        </div>

        <RadioGroup
          className="space-y-1"
          onValueChange={(value) => handleOptionSelect(field, value)}
          value={selectedValue || ""}
        >
          {options.map((option) => {
            const isSelected = selectedValue === option.value;
            return renderOptionItem(option, field, isSelected);
          })}
        </RadioGroup>

        {/* Selected option preview */}
        {selectedValue?.trim() !== "" && (
          <div className="mt-2 rounded-md border bg-muted/30 p-3">
            <div className="mb-2 flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-primary" />
              <span className="font-medium text-muted-foreground text-xs">
                Selected Preview
              </span>
            </div>
            {field === "logoUrl" && (
              <div className="flex items-center gap-3">
                <button
                  className="flex h-12 w-12 items-center justify-center rounded border bg-background transition-colors hover:bg-muted/50"
                  onClick={(e) => {
                    e.stopPropagation();
                    window.open(selectedValue, "_blank");
                  }}
                  type="button"
                >
                  <img
                    alt="Selected logo preview"
                    className="max-h-10 max-w-10 object-contain"
                    height={40}
                    src={selectedValue}
                    width={40}
                  />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="wrap-break-words font-medium text-sm">
                    {selectedValue}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Logo URL (click to view full size)
                  </p>
                </div>
              </div>
            )}
            {field === "streamUrl" && (
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded border bg-background">
                  <Volume2Icon className="h-6 w-6 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="break-all font-medium text-sm">
                    {selectedValue}
                  </p>
                  <p className="text-muted-foreground text-xs">Stream URL</p>
                </div>
                <Button
                  className="h-8"
                  onClick={(e) => {
                    e.stopPropagation();
                    // Test stream functionality
                  }}
                  size="sm"
                  variant="outline"
                >
                  <Volume2Icon className="mr-1 size-3" />
                  Test
                </Button>
              </div>
            )}
            {(field === "name" || field === "description") && (
              <div className="min-w-0 flex-1">
                <p className="wrap-break-words font-medium text-sm">
                  {selectedValue}
                </p>
                <p className="text-muted-foreground text-xs capitalize">
                  {field}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="font-medium text-sm">Found Radio Information</h3>
        <p className="text-muted-foreground text-xs">
          Review and select the information we found. You can choose from
          multiple options or enter custom values.
        </p>
      </div>

      {data.foundFields.length > 0 && (
        <div className="space-y-4">
          {renderFieldSection("name", "Station Name", data.name, true)}
          {renderFieldSection("streamUrl", "Stream URL", data.streamUrl)}
          {renderFieldSection("logoUrl", "Logo", data.logoUrl)}
          {renderFieldSection(
            "description",
            "Description",
            data.description,
            true
          )}
        </div>
      )}

      {data.missingFields.length > 0 && (
        <div className="space-y-1">
          <h4 className="font-medium text-amber-600 text-sm">
            Missing Information
          </h4>
          <p className="text-muted-foreground text-xs">
            We couldn't find the following information automatically. You'll
            need to add these manually in the next step:
          </p>
          <ul className="list-inside list-disc space-y-0.5 text-muted-foreground text-xs">
            {data.missingFields.map((field) => (
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

      <div className="flex gap-2 pt-4">
        <Button onClick={onTryAgain} variant="outline">
          Try Different URL
        </Button>
        <Button className="flex-1" onClick={handleContinue}>
          Continue to Form
        </Button>
      </div>
    </div>
  );
}
