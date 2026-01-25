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
import { setImageSize, useImageSize } from "@/lib/hooks/use-settings";

export function QualitySelect() {
  const imageSize = useImageSize();

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="quality">Image Quality</Label>
      <Select
        onValueChange={(value) => setImageSize(value as ImageSize)}
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
