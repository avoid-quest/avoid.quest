import { afterEach, expect, mock, test } from "bun:test";
import { installSettingsTestDom } from "./settings-test-dom";

if (process.env.AVOID_QUEST_IMPORT_REGRESSION) {
  installSettingsTestDom();
  const { cleanup, fireEvent, render, waitFor } = await import(
    "@testing-library/react"
  );
  const merge = mock(async (_data: unknown) => undefined);
  const replace = mock(async (_data: unknown) => undefined);
  let failPreview = false;
  const data = { id: "backup-a" };
  const otherData = { id: "backup-b" };
  mock.module("@/lib/db/export-import", () => ({
    copyShareUrlToClipboard: async () => undefined,
    exportDatabase: async () => undefined,
    generateShareUrl: async () => "",
    getLastExportDate: () => null,
    importFromFile: (file: File) => {
      if (file.name === "invalid.json") {
        throw new Error("invalid file");
      }
      return file.name === "backup-b.json" ? otherData : data;
    },
    importFromUrl: (url: string) => {
      if (url.endsWith("invalid")) {
        throw new Error("invalid URL");
      }
      return url.endsWith("backup-b") ? otherData : data;
    },
    mergeImportedData: merge,
    previewImportChanges: () => {
      if (failPreview) {
        throw new Error("invalid preview");
      }
      return {
        newRadios: 1,
        settingsChanged: false,
        unchangedRadios: 0,
        updatedRadios: 0,
      };
    },
    replaceImportedData: replace,
  }));
  mock.module("@/components/import-patch-preview", () => ({
    ImportPatchPreview: () => null,
  }));
  const { ImportExport } = await import("./import-export");
  afterEach(() => {
    cleanup();
    merge.mockClear();
    replace.mockClear();
    failPreview = false;
  });

  const changeUrl = (view: ReturnType<typeof render>, backup: string) => {
    fireEvent.change(view.getByLabelText("Share link"), {
      target: { value: backup ? `https://radio.test/${backup}` : "" },
    });
  };
  const previewUrl = (view: ReturnType<typeof render>) => {
    fireEvent.submit(
      view
        .getByRole("button", { name: "Preview" })
        .closest("form") as HTMLFormElement
    );
  };
  const selectFile = (view: ReturnType<typeof render>, backup: string) => {
    fireEvent.change(view.getByLabelText("Backup file"), {
      target: { files: [new File(["{}"], `${backup}.json`)] },
    });
  };

  for (const mode of ["merge", "replace"] as const) {
    const selectMode = (view: ReturnType<typeof render>) => {
      fireEvent.click(
        view.getByRole("radio", {
          name:
            mode === "merge"
              ? "Merge: update matching stations, add new ones hidden"
              : "Replace: overwrite the station list",
        })
      );
    };
    const apply = async (
      view: ReturnType<typeof render>,
      expectedData: typeof data
    ) => {
      fireEvent.click(
        await view.findByRole("button", { name: "Apply import" })
      );
      const importer = mode === "merge" ? merge : replace;
      await waitFor(() => expect(importer).toHaveBeenCalledWith(expectedData));
      expect(importer).toHaveBeenCalledTimes(1);
      expect(mode === "merge" ? replace : merge).not.toHaveBeenCalled();
    };

    for (const editedUrl of ["backup-b", ""] as const) {
      test(`url ${mode}: editing the previewed link to ${editedUrl || "empty"} requires a new preview`, async () => {
        const view = render(
          <ImportExport activePanel="import" resetContent={null} />
        );
        changeUrl(view, "backup-a");
        previewUrl(view);
        await view.findByRole("button", { name: "Apply import" });
        selectMode(view);

        changeUrl(view, editedUrl);
        expect(view.queryByRole("button", { name: "Apply import" })).toBeNull();
        expect(view.queryByRole("heading", { name: "Preview" })).toBeNull();
        expect(merge).not.toHaveBeenCalled();
        expect(replace).not.toHaveBeenCalled();

        if (!editedUrl) {
          changeUrl(view, "backup-b");
        }
        previewUrl(view);
        await apply(view, otherData);
      });
    }

    for (const source of ["file", "url"] as const) {
      test(`${source} ${mode}: unchanged source applies the previewed backup`, async () => {
        const view = render(
          <ImportExport activePanel="import" resetContent={null} />
        );
        if (source === "file") {
          selectFile(view, "backup-a");
        } else {
          changeUrl(view, "backup-a");
          previewUrl(view);
        }
        await view.findByRole("button", { name: "Apply import" });
        selectMode(view);
        await apply(view, data);
      });

      test(`${source} ${mode}: switching sources invalidates the old preview`, async () => {
        const view = render(
          <ImportExport activePanel="import" resetContent={null} />
        );
        if (source === "file") {
          selectFile(view, "backup-a");
        } else {
          changeUrl(view, "backup-a");
          previewUrl(view);
        }
        await view.findByRole("button", { name: "Apply import" });
        selectMode(view);

        if (source === "file") {
          changeUrl(view, "backup-b");
          expect(
            (view.getByLabelText("Backup file") as HTMLInputElement).files
              ?.length
          ).toBe(0);
          expect(
            view.queryByRole("button", { name: "Apply import" })
          ).toBeNull();
          expect(view.queryByRole("heading", { name: "Preview" })).toBeNull();
          expect(merge).not.toHaveBeenCalled();
          expect(replace).not.toHaveBeenCalled();
          previewUrl(view);
        } else {
          selectFile(view, "backup-b");
          expect(
            view.queryByRole("button", { name: "Apply import" })
          ).toBeNull();
          expect(
            (view.getByLabelText("Share link") as HTMLInputElement).value
          ).toBe("");
        }
        await apply(view, otherData);
      });
    }

    test(`file ${mode}: selecting another file previews and applies the new backup`, async () => {
      const view = render(
        <ImportExport activePanel="import" resetContent={null} />
      );
      selectFile(view, "backup-a");
      await view.findByRole("button", { name: "Apply import" });
      selectMode(view);
      selectFile(view, "backup-b");
      expect(view.queryByRole("button", { name: "Apply import" })).toBeNull();
      expect(merge).not.toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();
      await apply(view, otherData);
    });
  }

  for (const source of ["file", "url"] as const) {
    for (const mode of ["merge", "replace"] as const) {
      for (const failure of ["read", "preview"] as const) {
        test(`${source} ${mode}: failed ${failure} removes the previous actionable backup`, async () => {
          const view = render(
            <ImportExport activePanel="import" resetContent={null} />
          );
          const preview = (invalid: boolean) => {
            if (source === "file") {
              fireEvent.change(view.getByLabelText("Backup file"), {
                target: {
                  files: [
                    new File(["{}"], invalid ? "invalid.json" : "valid.json"),
                  ],
                },
              });
            } else {
              fireEvent.change(view.getByLabelText("Share link"), {
                target: {
                  value: `https://radio.test/${invalid ? "invalid" : "valid"}`,
                },
              });
              fireEvent.submit(
                view
                  .getByRole("button", { name: "Preview" })
                  .closest("form") as HTMLFormElement
              );
            }
          };
          preview(false);
          await view.findByRole("button", { name: "Apply import" });
          fireEvent.click(
            view.getByRole("radio", {
              name:
                mode === "merge"
                  ? "Merge: update matching stations, add new ones hidden"
                  : "Replace: overwrite the station list",
            })
          );
          failPreview = failure === "preview";
          preview(failure === "read");
          await waitFor(() =>
            expect(
              view.queryByRole("button", { name: "Apply import" })
            ).toBeNull()
          );
          await waitFor(() =>
            expect(
              view
                .getByRole("button", { name: "Preview" })
                .hasAttribute("disabled")
            ).toBe(false)
          );
          expect(merge).not.toHaveBeenCalled();
          expect(replace).not.toHaveBeenCalled();
          // A subsequent good preview still applies the selected mode and data.
          failPreview = false;
          preview(false);
          fireEvent.click(
            await view.findByRole("button", { name: "Apply import" })
          );
          await waitFor(() =>
            expect(mode === "merge" ? merge : replace).toHaveBeenCalledWith(
              data
            )
          );
        });
      }
    }
  }
} else {
  test("import draft regressions (isolated module mocks)", async () => {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, AVOID_QUEST_IMPORT_REGRESSION: "1" },
      stderr: "pipe",
      stdout: "pipe",
      timeout: 20_000,
    });
    const [stderr, exitCode] = await Promise.all([
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect({ errors: exitCode ? stderr : "", exitCode }).toEqual({
      errors: "",
      exitCode: 0,
    });
  }, 25_000);
}
