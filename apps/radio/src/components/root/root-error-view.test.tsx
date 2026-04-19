import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { AppError } from "@avoid.quest/error";
import { cleanup, render } from "@testing-library/react";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://radio.test",
});

for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
})) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value,
  });
}

const captureErrorMock = mock((_error: unknown, _meta: unknown) => undefined);

mock.module("@avoid.quest/error", () => {
  return {
    AppError,
    captureError: captureErrorMock,
  };
});

mock.module("@tanstack/react-router", () => {
  return {
    Link: ({
      children,
      to: _to,
    }: {
      children: React.ReactNode;
      to: string;
    }) => <a href="/">{children}</a>,
  };
});

let RootErrorView: typeof import("./root-error-view")["RootErrorView"];

beforeAll(async () => {
  ({ RootErrorView } = await import("./root-error-view"));
});

afterEach(() => {
  cleanup();
  captureErrorMock.mockClear();
});

function renderError(error: Error) {
  return render(<RootErrorView error={error} reset={() => undefined} />);
}

describe("RootErrorView", () => {
  test("renders the safe AppError message and reports it", () => {
    const error = new AppError({
      code: "ROOT_FAILURE",
      safeMessage: "Readable failure",
      category: "infrastructure",
      expected: false,
      status: 500,
    });

    const view = renderError(error);

    expect(view.getByText("Readable failure")).toBeTruthy();
    expect(captureErrorMock).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        surface: "ui",
        operation: "root-error-boundary",
      })
    );
  });

  test("falls back to the generic message for unknown errors", () => {
    const view = renderError(new Error("boom"));

    expect(
      view.getByText("Something went wrong. Please try again.")
    ).toBeTruthy();
  });
});
