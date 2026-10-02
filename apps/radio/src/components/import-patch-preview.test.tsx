import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ImportPatchPreview } from "./import-patch-preview";

test("file preview explains patch and output-level replacement in both modes", () => {
  const preview = renderToStaticMarkup(
    <ImportPatchPreview
      patch={{ masterVolume: 0.23, replacesNewerVersion: true }}
    />
  );
  expect(preview).toContain(
    "Merge and Replace both replace your current Node patch"
  );
  expect(preview).toContain("Speakers level to 23%");
  expect(preview).toContain("replaces the patch saved by a newer app version");
});

test("station-only share-link previews have no patch replacement notice", () => {
  expect(renderToStaticMarkup(<ImportPatchPreview patch={undefined} />)).toBe(
    ""
  );
});
