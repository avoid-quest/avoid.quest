import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { GenreBadges, splitGenres } from "./genre-badges";

describe("splitGenres", () => {
  test("splits on common separators and dedupes case-insensitively", () => {
    expect(splitGenres("Rock/Pop; Jazz, rock, ROCK, various")).toEqual([
      "Rock",
      "Pop",
      "Jazz",
    ]);
    expect(splitGenres("Ambient | Drone|drone ,  , Techno")).toEqual([
      "Ambient",
      "Drone",
      "Techno",
    ]);
  });

  test("keeps a spaced slash inside one genre label", () => {
    expect(splitGenres("R&B / Soul, Hip Hop/Rap")).toEqual([
      "R&B / Soul",
      "Hip Hop",
      "Rap",
    ]);
  });

  test("drops placeholder genres", () => {
    expect(splitGenres("Misc, Other, n/a, unknown, 78cxy6wkxtzuv")).toEqual([]);
    expect(splitGenres(null)).toEqual([]);
    expect(splitGenres(undefined)).toEqual([]);
  });
});

describe("GenreBadges", () => {
  test("does not name the list, so a parent button keeps the genre text", () => {
    const markup = renderToStaticMarkup(<GenreBadges genre="Krautrock" />);
    expect(markup).not.toContain("aria-label");
    expect(markup).toContain("Krautrock");
  });
});
