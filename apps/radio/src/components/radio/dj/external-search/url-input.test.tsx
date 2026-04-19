import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
// @ts-expect-error jsdom types are not installed in this workspace.
import { JSDOM } from "jsdom";
import {
  act,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import type { Radio } from "@/lib/audio";

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

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  writable: true,
  value: true,
});

type TrackLoadOptions = {
  onLoad: (radio: Radio) => void;
  onError?: (message: string, code: string) => void;
  onSettled?: () => void;
};

let trackLoadOptions: TrackLoadOptions | undefined;
const mutateMock = mock((_url: string) => undefined);

mock.module("@avoid.quest/ui/components/button", () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

mock.module("@avoid.quest/ui/components/collapsible", () => ({
  Collapsible: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CollapsibleContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  CollapsibleTrigger: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

mock.module("@avoid.quest/ui/components/input", () => ({
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

mock.module("@/lib/hooks/use-dj-track-load", () => ({
  useDjTrackLoad: (options: TrackLoadOptions) => {
    trackLoadOptions = options;
    return {
      mutate: mutateMock,
      isPending: false,
    };
  },
}));

let UrlInput: typeof import("./url-input")["UrlInput"];

beforeAll(async () => {
  ({ UrlInput } = await import("./url-input"));
});

beforeEach(() => {
  trackLoadOptions = undefined;
  mutateMock.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("UrlInput", () => {
  test("shows track-load failures inline after submitting a URL", () => {
    const view = render(<UrlInput onLoad={() => undefined} />);
    fireEvent.change(view.getByPlaceholderText("https://..."), {
      target: { value: "https://soundcloud.com/test/track" },
    });

    expect(trackLoadOptions).toBeDefined();

    act(() => {
      trackLoadOptions?.onError?.(
        "Track rejected",
        "DJ_TRACK_RESOLUTION_FAILED"
      );
    });

    expect(view.getByText("Track rejected")).toBeTruthy();
  });
});
