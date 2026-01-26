import {
  IMAGE_SIZE_LABELS,
  IMAGE_SIZES,
  type ImageSize,
} from "@avoid.quest/pinterest";
import { Label } from "@avoid.quest/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@avoid.quest/ui/components/select";
import { DEFAULT_IMAGE_SIZE } from "@/lib/const";
import { setImageSize, useSettings } from "@/lib/hooks/use-settings";

function isImageSize(value: string): value is ImageSize {
  return (IMAGE_SIZES as readonly string[]).includes(value);
}

export function QualitySelect() {
  const { data: settings } = useSettings();
  const imageSize = settings?.imageSize ?? DEFAULT_IMAGE_SIZE;

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="quality">Image Quality</Label>
      <Select
        onValueChange={(value) => {
          if (isImageSize(value)) {
            setImageSize(value);
          }
        }}
        value={imageSize}
      >
        <SelectTrigger id="quality">
          <SelectValue placeholder="Select quality" />
        </SelectTrigger>
        <SelectContent>
          {IMAGE_SIZES.map((size) => (
            <SelectItem key={size} value={size}>
              {IMAGE_SIZE_LABELS[size]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
