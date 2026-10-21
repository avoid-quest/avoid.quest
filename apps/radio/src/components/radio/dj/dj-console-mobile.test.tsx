// biome-ignore-all lint/performance/noJsxPropsBind: local state in the panel test double
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { installAnimationTestEnvironment } from "./shared/animation-test-utils";

const renderedDeckIds: string[] = [];
const DECK_A_TAB = /^A/;
const DECK_B_TAB = /^B/;
const handleChange = () => undefined;

mock.module("./deck/deck-panel", () => ({
  DeckPanel: ({ deckId, visible }: { deckId: string; visible: boolean }) => {
    const [query, setQuery] = useState("");
    const [draft, setDraft] = useState("");
    renderedDeckIds.push(deckId);
    return (
      <div data-visible={visible}>
        {deckId}
        <input
          aria-label={`${deckId} query`}
          onInput={(event) => setQuery(event.currentTarget.value)}
          value={query}
        />
        <textarea
          aria-label={`${deckId} draft`}
          onInput={(event) => setDraft(event.currentTarget.value)}
          value={draft}
        />
      </div>
    );
  },
}));

mock.module("@/components/settings/settings-button", () => ({
  SettingsButton: () => <button type="button">settings</button>,
}));

let DjConsoleMobile: typeof import("./dj-console-mobile")["DjConsoleMobile"];
let clock: ReturnType<typeof installAnimationTestEnvironment>;
beforeAll(async () => {
  ({ DjConsoleMobile } = await import("./dj-console-mobile"));
});
beforeEach(() => {
  clock = installAnimationTestEnvironment();
});
afterEach(() => {
  cleanup();
  clock.restore();
});

function consoleView() {
  return (
    <DjConsoleMobile
      crossfadePosition={0.5}
      deckACueEnabled={false}
      deckBCueEnabled={false}
      isCueActive={false}
      masterVolume={0.8}
      onCrossfadeChange={handleChange}
      onDeckACueChange={handleChange}
      onDeckBCueChange={handleChange}
      onMasterVolumeChange={handleChange}
      radios={[]}
    />
  );
}

describe("DjConsoleMobile", () => {
  test("mounts both panels and hides the inactive deck", () => {
    renderedDeckIds.length = 0;
    const html = renderToStaticMarkup(consoleView());
    expect(renderedDeckIds).toEqual(["deck-a", "deck-b"]);
    expect(html.includes('hidden=""')).toBeTrue();
    expect(html.includes('inert=""')).toBeTrue();
    expect(html.includes('data-visible="false"')).toBeTrue();
  });

  test("A to B to A retains per-deck search and unapplied draft state", () => {
    const view = render(consoleView());
    const query = view.getByLabelText("deck-a query") as HTMLInputElement;
    const draft = view.getByLabelText("deck-a draft") as HTMLTextAreaElement;
    fireEvent.input(query, { target: { value: "ambient" } });
    fireEvent.input(draft, { target: { value: "unapplied processor" } });
    fireEvent.mouseDown(view.getByRole("tab", { name: DECK_B_TAB }), {
      button: 0,
      ctrlKey: false,
    });
    expect(
      view.getByLabelText("deck-a query").closest("[hidden]")
    ).toBeTruthy();
    expect(view.getByLabelText("deck-b query").closest("[hidden]")).toBeNull();
    fireEvent.input(view.getByLabelText("deck-b query"), {
      target: { value: "jazz" },
    });
    fireEvent.mouseDown(view.getByRole("tab", { name: DECK_A_TAB }), {
      button: 0,
      ctrlKey: false,
    });
    expect(view.getByLabelText("deck-a query")).toBe(query);
    expect(query.value).toBe("ambient");
    expect(draft.value).toBe("unapplied processor");
    expect(
      (view.getByLabelText("deck-b query") as HTMLInputElement).value
    ).toBe("jazz");
    act(() => clock.advance(1000));
  });
});
