import { beforeAll, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

const renderedDeckIds: string[] = [];
const handleChange = () => undefined;

mock.module("./deck/deck-panel", () => ({
  DeckPanel: ({ deckId }: { deckId: string }) => {
    renderedDeckIds.push(deckId);
    return <div>{deckId}</div>;
  },
}));

mock.module("@/components/settings/settings-button", () => ({
  SettingsButton: () => <button type="button">settings</button>,
}));

let DjConsoleMobile: typeof import("./dj-console-mobile")["DjConsoleMobile"];

beforeAll(async () => {
  ({ DjConsoleMobile } = await import("./dj-console-mobile"));
});

describe("DjConsoleMobile", () => {
  test("mounts only active deck panel", () => {
    renderedDeckIds.length = 0;

    const html = renderToStaticMarkup(
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

    expect(renderedDeckIds).toEqual(["deck-a"]);
    expect(html.includes("deck-a")).toBeTrue();
    expect(html.includes("deck-b")).toBeFalse();
  });
});
