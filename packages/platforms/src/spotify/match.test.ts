import { describe, expect, test } from "bun:test";
import youtubeSearch from "./fixtures/youtube-search.json";
import {
  buildSpotifyYouTubeQuery,
  cleanSpotifyTitle,
  rankYouTubeCandidates,
  scoreYouTubeCandidate,
  selectYouTubeMatch,
} from "./match";
import type { SpotifyMatchTrack, SpotifyYouTubeCandidate } from "./types";

// Live search results recorded on 2026-10-01 (see RESEARCH.md).
const search = youtubeSearch as Record<string, SpotifyYouTubeCandidate[]>;
function results(key: string): SpotifyYouTubeCandidate[] {
  const found = search[key];
  if (!found) {
    throw new Error(`Missing fixture ${key}`);
  }
  return found;
}

const GET_LUCKY: SpotifyMatchTrack = {
  artists: ["Daft Punk", "Pharrell Williams", "Nile Rodgers"],
  duration: 247.632,
  name: "Get Lucky (Radio Edit) [feat. Pharrell Williams and Nile Rodgers]",
};
const ONE_MORE_TIME: SpotifyMatchTrack = {
  artists: ["Daft Punk"],
  duration: 320.357,
  name: "One More Time",
};
const TELL_ME: SpotifyMatchTrack = {
  artists: ["Rahill"],
  duration: 161.36,
  name: "Tell Me",
};

describe("query building", () => {
  test("drops featured artists and remaster notes from the title", () => {
    expect(cleanSpotifyTitle(GET_LUCKY.name)).toBe("Get Lucky (Radio Edit)");
    expect(
      cleanSpotifyTitle("Comfortably Numb - 2011 Remastered Version")
    ).toBe("Comfortably Numb");
    expect(cleanSpotifyTitle("Time (2011 Remaster)")).toBe("Time");
    expect(cleanSpotifyTitle("Around the World - M.A.W Remix")).toBe(
      "Around the World - M.A.W Remix"
    );
  });

  test("searches the primary artist and cleaned title", () => {
    expect(buildSpotifyYouTubeQuery(GET_LUCKY)).toBe(
      "Daft Punk Get Lucky (Radio Edit)"
    );
  });
});

describe("match scoring", () => {
  test("picks the radio edit by duration over the album version", () => {
    const match = selectYouTubeMatch(
      GET_LUCKY,
      results("piped-songs: Daft Punk Get Lucky (Radio Edit)")
    );
    expect(match).toMatchObject({
      author: "Daft Punk",
      duration: 249,
      videoId: "Rgrt_8mXrK8",
    });
    expect(match?.durationDelta).toBeCloseTo(1.368, 3);
    expect(match?.score).toBeGreaterThan(0.9);
  });

  test("close duration wins between equally titled official uploads", () => {
    const official = {
      author: "Daft Punk",
      title: "Daft Punk - One More Time (Official Audio)",
    };
    const ranked = rankYouTubeCandidates(ONE_MORE_TIME, [
      { ...official, duration: 331, videoId: "far00000000" },
      { ...official, duration: 321, videoId: "close000000" },
    ]);
    expect(ranked.map((match) => match.videoId)).toEqual([
      "close000000",
      "far00000000",
    ]);
  });

  test("prefers official uploads and penalizes live versions", () => {
    const ranked = rankYouTubeCandidates(
      TELL_ME,
      results("invidious: Rahill Tell Me")
    );
    const ids = ranked.map((match) => match.videoId);
    expect(ids[0]).toBe("st1qchy2tyc"); // Official Video, 161 s
    expect(ids.slice(0, 2)).toContain("nLKXv_1tos0"); // Official Audio
    // "Live at The Getty Center" is close in duration but ranks below both.
    const live = ids.indexOf("kOxSr9AW7oQ");
    expect(live === -1 || live > 1).toBe(true);
  });

  test("rejects when every candidate is a different song", () => {
    const youWantItDarker: SpotifyMatchTrack = {
      artists: ["Leonard Cohen"],
      duration: 284.363,
      name: "You Want It Darker",
    };
    expect(
      selectYouTubeMatch(
        youWantItDarker,
        results("piped-songs: Rahill Tell Me")
      )
    ).toBeNull();
  });

  test("rejects the right song when no upload is close enough in duration", () => {
    const candidates = results("invidious: Daft Punk One More Time").filter(
      (candidate) =>
        candidate.videoId === "bmjsUsS8QuM" || // 12" Mix, 481 s
        candidate.videoId === "BMC8nTo5oJo" // Live, 157 s
    );
    expect(candidates).toHaveLength(2);
    expect(selectYouTubeMatch(ONE_MORE_TIME, candidates)).toBeNull();
    const [twelveInchMix] = candidates;
    if (!twelveInchMix) {
      throw new Error('Missing 12" Mix fixture');
    }
    expect(scoreYouTubeCandidate(ONE_MORE_TIME, twelveInchMix)).toMatchObject({
      rejection: "duration too far off",
    });
  });

  test("rejects unwanted variants and wrong artists outright", () => {
    const base = { duration: 320, videoId: "x0000000000" };
    expect(
      scoreYouTubeCandidate(ONE_MORE_TIME, {
        ...base,
        author: "Nightcore Hub",
        title: "Daft Punk - One More Time (Nightcore)",
      }).rejection
    ).toBe("unwanted variant (nightcore)");
    expect(
      scoreYouTubeCandidate(ONE_MORE_TIME, {
        ...base,
        author: "Estelle",
        title: "One More Time",
      }).rejection
    ).toBe("artist does not match");
    expect(
      scoreYouTubeCandidate(ONE_MORE_TIME, {
        ...base,
        author: "Daft Punk",
        duration: 0,
        title: "One More Time",
      }).rejection
    ).toBe("no duration");
  });

  test("ignores duplicate video ids", () => {
    const candidate = {
      author: "Daft Punk",
      duration: 321,
      title: "One More Time",
      videoId: "fa5IWHDbftI",
    };
    expect(
      rankYouTubeCandidates(ONE_MORE_TIME, [candidate, candidate])
    ).toHaveLength(1);
  });

  test.each([
    ["The National", "The Chainsmokers - Topic"],
    ["The Beatles", "The Weeknd - Topic"],
    ["Daft Punk", "Daft - Topic"],
  ])("rejects partial artist matches for %s", (artist, author) => {
    expect(
      scoreYouTubeCandidate(
        { artists: [artist], duration: 180, name: "Tell Me" },
        { author, duration: 180, title: "Tell Me", videoId: "x0000000000" }
      ).rejection
    ).toBe("artist does not match");
  });

  test.each([
    ["Perfect", "Ed Sheeran", 263, "Perfect Duet (with Beyoncé)", 259],
    ["One", "U2", 276, "One Love", 280],
    ["Stay", "Rihanna", 240, "Stay With Me", 240],
  ])(
    "rejects %s for a longer title by %s",
    (name, artist, duration, title, youtubeDuration) => {
      expect(
        scoreYouTubeCandidate(
          { artists: [artist], duration, name },
          {
            author: `${artist} - Topic`,
            duration: youtubeDuration,
            title,
            videoId: "x0000000000",
          }
        ).rejection
      ).toBe("title has extra words");
    }
  );

  test("never ranks a longer title as the runner-up", () => {
    const perfect = { artists: ["Ed Sheeran"], duration: 263, name: "Perfect" };
    const ranked = rankYouTubeCandidates(perfect, [
      {
        author: "Ed Sheeran - Topic",
        duration: 263,
        title: "Perfect",
        videoId: "exact000000",
      },
      {
        author: "Ed Sheeran - Topic",
        duration: 259,
        title: "Perfect Duet (with Beyoncé)",
        videoId: "duet0000000",
      },
    ]);
    expect(ranked.map((match) => match.videoId)).toEqual(["exact000000"]);
  });

  test("ignores bracketed and trailing notes when checking for extra words", () => {
    const hello = { artists: ["Adele"], duration: 367, name: "Hello" };
    for (const { author, title } of [
      {
        author: "AdeleVEVO",
        title: "Adele - Hello (Official Music Video) | Vevo",
      },
      { author: "AdeleVEVO", title: "Hello - Adele | 25" },
      {
        author: "Adele",
        title: "Adele - Hello (Official Video 2015) [4K Remaster]",
      },
      { author: "Uploader", title: "Adele - Hello - Radio Edit" },
    ]) {
      expect(
        scoreYouTubeCandidate(hello, {
          author,
          duration: 367,
          title,
          videoId: "x0000000000",
        }).rejection
      ).toBeUndefined();
    }
  });

  test.each([
    ["Yesterday - Remastered 2009", "The Beatles", 125],
    ["Help! - Remastered 2009", "The Beatles", 139],
    ["Dreams - 2004 Remaster", "Fleetwood Mac", 257],
  ])("matches the identical Topic upload of %s", (name, artist, duration) => {
    expect(
      scoreYouTubeCandidate(
        { artists: [artist], duration, name },
        {
          author: `${artist} - Topic`,
          duration,
          title: name,
          videoId: "x0000000000",
        }
      ).rejection
    ).toBeUndefined();
  });

  test.each([
    [
      "Gangnam Style (강남스타일)",
      "PSY",
      "PSY - GANGNAM STYLE(강남스타일) M/V",
    ],
    ["Hello", "Adele", "Hello by Adele"],
    ["Yesterday", "The Beatles", "The Beatles - Yesterday Remastered 2009"],
  ])("does not count notes in %s as extra words", (name, artist, title) => {
    expect(
      scoreYouTubeCandidate(
        { artists: [artist], duration: 240, name },
        { author: "Uploader", duration: 240, title, videoId: "x0000000000" }
      ).rejection
    ).toBeUndefined();
  });

  test("still rejects a longer title that only adds by", () => {
    expect(
      scoreYouTubeCandidate(
        { artists: ["U2"], duration: 276, name: "One" },
        {
          author: "Uploader",
          duration: 276,
          title: "One Love by U2",
          videoId: "x0000000000",
        }
      ).rejection
    ).toBe("title has extra words");
  });

  test.each([
    ["The The", "The The - Topic", "This Is the Day"],
    ["The The", "THE THE", "This Is the Day"],
    ["The The", "Uploader", "The The - This Is the Day"],
    ["!!!", "!!! - Topic", "Heart of Hearts"],
    ["!!!", "Uploader", "!!! (Chk Chk Chk) - Heart of Hearts"],
  ])(
    "matches %s, whose name has no ordinary words",
    (artist, author, title) => {
      const name = title.split(" - ").at(-1) ?? title;
      expect(
        scoreYouTubeCandidate(
          { artists: [artist], duration: 300, name },
          { author, duration: 300, title, videoId: "a0000000000" }
        ).rejection
      ).toBeUndefined();
    }
  );

  test.each([
    ["The The", "Uploader", "This Is the Day"],
    ["!!!", "Uploader", "Heart of Hearts!!!"],
  ])("still rejects uploads that never name %s", (artist, author, title) => {
    expect(
      scoreYouTubeCandidate(
        { artists: [artist], duration: 300, name: title.replace("!!!", "") },
        { author, duration: 300, title, videoId: "a0000000000" }
      ).rejection
    ).toBe("artist does not match");
  });

  test.each([
    ["The", "End", "The Beatles - Topic", "The End"],
    ["The", "End", "Uploader", "The End"],
    ["!!!", "Heart of Hearts", "Uploader", "Heart of Hearts - Wow !!!"],
  ])(
    "does not find %s in a longer channel name or title",
    (artist, name, author, title) => {
      expect(
        scoreYouTubeCandidate(
          { artists: [artist], duration: 300, name },
          { author, duration: 300, title, videoId: "a0000000000" }
        ).rejection
      ).toBe("artist does not match");
    }
  );

  test("accepts full artist credits in the channel or title", () => {
    for (const { artists, author, title } of [
      {
        artists: ["The Beatles"],
        author: "Beatles - Topic",
        title: "One More Time",
      },
      {
        artists: ["Daft Punk"],
        author: "Uploader",
        title: "Daft Punk - One More Time (Official Audio)",
      },
      {
        artists: ["Daft Punk", "Pharrell Williams"],
        author: "Pharrell Williams - Topic",
        title: "One More Time",
      },
    ]) {
      expect(
        scoreYouTubeCandidate(
          { ...ONE_MORE_TIME, artists },
          { author, duration: 320, title, videoId: "x0000000000" }
        ).rejection
      ).toBeUndefined();
    }
  });
});
