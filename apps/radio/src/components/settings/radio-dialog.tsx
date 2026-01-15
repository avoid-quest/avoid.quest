import type { Radio, RadioMetadata } from "@avoid.quest/cacophony";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { useState } from "react";
import { RadioAddModeSelector } from "./radio-add-mode-selector";
import { RadioForm } from "./radio-form";
import { RadioGuidedForm } from "./radio-guided-form";
import { RadioScrapedResults } from "./radio-scraped-results";

type RadioDialogProps = {
  mode: "create" | "edit";
  radio?: Radio;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type DialogStep = "select-mode" | "guided" | "selection" | "manual";

export function RadioDialog({
  mode,
  radio,
  open,
  onOpenChange,
}: RadioDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentStep, setCurrentStep] = useState<DialogStep>("select-mode");
  const [scrapedData, setScrapedData] = useState<RadioMetadata | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSuccess = () => {
    setIsSubmitting(false);
    onOpenChange(false);
    // Reset state when dialog closes
    setCurrentStep("select-mode");
    setScrapedData(null);
    setError(null);
  };

  const handleCancel = () => {
    if (!isSubmitting) {
      onOpenChange(false);
      // Reset state when dialog closes
      setCurrentStep("select-mode");
      setScrapedData(null);
      setError(null);
    }
  };

  const handleModeChange = (newMode: "guided" | "manual") => {
    if (newMode === "guided") {
      setCurrentStep("guided");
    } else {
      setCurrentStep("manual");
    }
  };

  const handleScrapedData = (data: RadioMetadata) => {
    setScrapedData(data);
    setCurrentStep("selection");
    setError(null);
  };

  const handleError = (errorMessage: string) => {
    setError(errorMessage);
  };

  const getDialogTitle = () => {
    if (mode === "edit") {
      return "Edit Radio Station";
    }
    if (currentStep === "select-mode") {
      return "Add Radio Station";
    }
    if (currentStep === "guided") {
      return "Add Radio Station - Guided";
    }
    if (currentStep === "selection") {
      return "Review Found Information";
    }
    return "Add Radio Station - Manual";
  };

  const getDialogDescription = () => {
    if (mode === "edit") {
      return "Update the radio station details.";
    }
    if (currentStep === "select-mode") {
      return "Choose how you'd like to add a new radio station.";
    }
    if (currentStep === "guided") {
      return "Enter the radio station's website URL to automatically find details.";
    }
    if (currentStep === "selection") {
      return "Review and select the information we found for your radio station.";
    }
    return "Manually enter all radio station details.";
  };

  const handleSelectionContinue = (data: RadioMetadata) => {
    setScrapedData(data);
    setCurrentStep("manual");
  };

  const handleSelectionTryAgain = () => {
    setScrapedData(null);
    setCurrentStep("guided");
  };

  const renderContent = () => {
    if (mode === "edit" || currentStep === "manual") {
      return (
        <RadioForm
          mode={mode}
          onCancel={handleCancel}
          onSuccess={handleSuccess}
          radio={radio}
          scrapedData={scrapedData}
        />
      );
    }

    if (currentStep === "select-mode") {
      return <RadioAddModeSelector onModeChange={handleModeChange} />;
    }

    if (currentStep === "guided") {
      return (
        <div className="space-y-4">
          <RadioGuidedForm
            onError={handleError}
            onScrapedData={handleScrapedData}
          />
          {!!error?.trim() && (
            <div className="rounded-md bg-destructive/10 p-3">
              <p className="text-destructive text-sm">{error}</p>
            </div>
          )}
        </div>
      );
    }

    if (currentStep === "selection" && scrapedData) {
      return (
        <RadioScrapedResults
          data={scrapedData}
          onContinue={handleSelectionContinue}
          onTryAgain={handleSelectionTryAgain}
        />
      );
    }

    return null;
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[90vh] w-full max-w-7xl xl:max-w-[90vw] 2xl:max-w-[80vw]">
        <DialogHeader className="shrink-0">
          <DialogTitle>{getDialogTitle()}</DialogTitle>
          <DialogDescription>{getDialogDescription()}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">{renderContent()}</div>
      </DialogContent>
    </Dialog>
  );
}
