import { expect, test } from "@playwright/test";

test("a locked provider follows props and resets its UI state", async ({
  page,
}) => {
  await page.goto("/e2e/testbed.html?module=/e2e/external-search-harness.tsx");
  await page.waitForFunction(
    () =>
      (window as Window & { __externalSearchReady?: boolean })
        .__externalSearchReady === true
  );

  const query = page.getByPlaceholder("Search tracks, albums...");
  await expect(page.getByText("Bandcamp", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Tracks & albums from independent artists")
  ).toBeVisible();
  await query.fill("ambient");

  await page.evaluate(() => {
    (
      window as unknown as Window & {
        __setExternalSearchPlatform: (platform: string) => void;
      }
    ).__setExternalSearchPlatform("soundcloud");
  });

  await expect(page.getByText("SoundCloud", { exact: true })).toBeVisible();
  await expect(page.getByText("Tracks, mixes & DJ sets")).toBeVisible();
  await expect(query).toHaveValue("");
});
