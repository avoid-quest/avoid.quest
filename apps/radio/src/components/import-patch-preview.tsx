import type { ImportPreview } from "@/lib/types";

export function ImportPatchPreview({
  patch,
}: {
  patch: ImportPreview["nodePatch"];
}) {
  if (!patch) {
    return null;
  }
  return (
    <div className="space-y-1 text-muted-foreground text-xs">
      <p>
        Merge and Replace both replace your current Node patch and set Speakers
        level to {Number((patch.masterVolume * 100).toFixed(2))}%.
      </p>
      {patch.replacesNewerVersion ? (
        <p>This also replaces the patch saved by a newer app version.</p>
      ) : null}
    </div>
  );
}
