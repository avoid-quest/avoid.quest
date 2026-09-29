import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { AppError } from "@avoid.quest/error";
import { cleanup, render } from "@testing-library/react";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://radio.test",
});

for (const [key, value] of Object.entries({
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  navigator: dom.window.navigator,
  window: dom.window,
})) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value,
    writable: true,
  });
}

const captureErrorMock = mock((_error: unknown, _meta: unknown) => undefined);

mock.module("@avoid.quest/error", () => ({
  AppError,
  captureError: captureErrorMock,
}));

mock.module("@tanstack/react-router", () => ({
  Link: ({ children, to: _to }: { children: React.ReactNode; to: string }) => (
    <a href="/">{children}</a>
  ),
}));

let RootErrorView: typeof import("./root-error-view")["RootErrorView"];
const resetError = () => undefined;

beforeAll(async () => {
  ({ RootErrorView } = await import("./root-error-view"));
});

afterEach(() => {
  cleanup();
  captureErrorMock.mockClear();
});

function renderError(error: Error) {
  return render(<RootErrorView error={error} reset={resetError} />);
}

describe("RootErrorView", () => {
  test("renders the safe AppError message and reports it", () => {
    const error = new AppError({
      category: "infrastructure",
      code: "ROOT_FAILURE",
      expected: false,
      safeMessage: "Readable failure",
      status: 500,
    });

    const view = renderError(error);

    expect(view.getByText("Readable failure")).toBeTruthy();
    expect(captureErrorMock).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        operation: "root-error-boundary",
        surface: "ui",
      })
    );
  });

  test("falls back to the generic message for unknown errors", () => {
    const view = renderError(new Error("boom"));

    expect(
      view.getByText("An unexpected error stopped this page.")
    ).toBeTruthy();
  });
});
