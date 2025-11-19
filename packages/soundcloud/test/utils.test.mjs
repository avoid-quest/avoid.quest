import { describe, expect, test } from "vitest";
import * as scdl from "../dist/index.mjs";
import { PLAYLIST_URL, TRACK_URL } from "./urls.mjs";

const trackURL = process.env.TRACK_URL || TRACK_URL;
const playlistURL = process.env.PLAYLIST_URL || PLAYLIST_URL;

describe.skipIf(!trackURL)("track", function () {
    test("TrackURLPattern matches groups properly", function () {
        const result = trackURL.match(scdl.TrackURLPattern);
        expect(result).not.toBeNull();
        expect(result.groups?.user).toBeTypeOf("string");
        expect(result.groups?.title).toBeTypeOf("string");
    });
    test("validateURL sync checks format", function () {
        expect(scdl.validateURL(trackURL)).toBe(true);
        expect(scdl.validateURL(trackURL)).toBe(true);
        expect(scdl.validateURL("https://soundcloud.com/")).toBe(false);
    });
    test("getPermalinkURL always string", function () {
        expect(scdl.getPermalinkURL(trackURL)).toBeTypeOf("string");
        expect(scdl.getPermalinkURL("foobar")).toBeTypeOf("string");
    });
});

describe.skipIf(!playlistURL)("playlist", function () {
    test("PlaylistURLPattern matches groups properly", function () {
        const result = playlistURL.match(scdl.PlaylistURLPattern);
        expect(result).not.toBeNull();
        expect(result.groups?.user).toBeTypeOf("string");
        expect(result.groups?.title).toBeTypeOf("string");
    });
    test("validatePlaylistURL sync checks format", function () {
        expect(scdl.validatePlaylistURL(playlistURL)).toBe(true);
        expect(scdl.validatePlaylistURL("https://soundcloud.com/")).toBe(false);
    });
    test("getPlaylistPermalinkURL always string", function () {
        expect(scdl.getPlaylistPermalinkURL(playlistURL)).toBeTypeOf("string");
        expect(scdl.getPlaylistPermalinkURL("foobar")).toBeTypeOf("string");
    });
});
