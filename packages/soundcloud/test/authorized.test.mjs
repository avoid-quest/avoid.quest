import { fetchClientID } from "@scdl/fetch-client";
import { once } from "events";
import { beforeAll, describe, expect, test } from "vitest";
import * as scdl from "../dist/index.mjs";
import { PLAYLIST_URL, TRACK_URL } from "./urls.mjs";

const trackURL = process.env.TRACK_URL || TRACK_URL;
const playlistURL = process.env.PLAYLIST_URL || PLAYLIST_URL;

beforeAll(async function () {
    scdl.setClientID(await fetchClientID());
}, 5000);

describe.skipIf(!trackURL)("track", function () {
    test("stream readable has transcoding property", { timeout: 5000 }, async function () {
        const output = await scdl.stream(trackURL);
        expect(output.transcoding).toBeTypeOf("object");
    });
    test("streamSync emits transcoding", { timeout: 5000 }, async function () {
        const output = scdl.streamSync(trackURL);
        await once(output, "transcoding");
    });
    test("streamSync populates with data", { timeout: 5000 }, async function () {
        const output = scdl.streamSync(trackURL);
        await once(output, "data");
    });
    describe("from info", function () {
        let info;
        beforeAll(async function () {
            info = await scdl.getInfo(trackURL);
            expect(info.data.media.transcodings).not.toHaveLength(0);
        }, 5000);
        test.each([
            scdl.Protocol.PROGRESSIVE,
            scdl.Protocol.HLS
        ])("can stream %s", { timeout: 5000 }, async function (protocol) {
            try {
                await scdl.streamFromInfo(info, {
                    protocol,
                    strict: true
                });
            }
            catch (error) {
                expect(error.message).toBe("Failed to obtain transcoding");
                console.warn(`Failed to obtain transcoding`);
            }
        });
        test("info is wrapped in data object for symmetry", function () {
            expect(info.data).toBeTypeOf("object");
        });
        test("streamFromInfo readable has transcoding property", { timeout: 5000 }, async function () {
            const output = await scdl.streamFromInfo(info);
            expect(output.transcoding).toBeTypeOf("object");
        });
        test("streamFromInfoSync stream emits transcoding", { timeout: 5000 }, async function () {
            const output = scdl.streamFromInfoSync(info);
            await once(output, "transcoding");
        });
        test("streamFromInfoSync stream populates with data", { timeout: 5000 }, async function () {
            const output = scdl.streamFromInfoSync(info);
            await once(output, "data");
        });
    });
});

describe.skipIf(!playlistURL)("playlist", function () {
    test("streamPlaylist readables have transcoding property", { timeout: 60000 }, async function () {
        const result = await scdl.streamPlaylist(playlistURL);
        expect(Array.isArray(result)).toBe(true);
        for (const item of result) {
            expect.soft(item).toSatisfy(value => value === null || typeof value.transcoding === "object");
        }
    });
    describe("from info", function () {
        let info;
        beforeAll(async function () {
            info = await scdl.getPlaylistInfo(playlistURL);
        }, 5000);
        test("fetchPartialPlaylist works as intended", { timeout: 60000 }, async function () {
            if (scdl.isPlaylistFetched(info)) {
                console.warn("All track data already present. Skipping fetchPartialPlaylist test.");
                return;
            }
            await scdl.fetchPartialPlaylist(info);
            expect(scdl.isPlaylistFetched(info)).toBe(true);
        });
        test("streamPlaylistFromInfo readables have transcoding property", { timeout: 60000 }, async function () {
            const result = await scdl.streamPlaylistFromInfo(info);
            expect(Array.isArray(result)).toBe(true);
            for (const item of result) {
                expect.soft(item).toSatisfy(value => value === null || typeof value.transcoding === "object");
            }
        });
        test("streamPlaylistFromInfoSync streams emit transcoding", { timeout: 60000 }, async function () {
            const output = scdl.streamPlaylistFromInfoSync(info);
            expect(Array.isArray(output)).toBe(true);
            await Promise.allSettled(output.map(stream => once(stream, "transcoding")));
        });
        test("streamPlaylistFromInfoSync streams populate with data", { timeout: 60000 }, async function () {
            const output = scdl.streamPlaylistFromInfoSync(info);
            expect(Array.isArray(output)).toBe(true);
            await Promise.allSettled(output.map(stream => once(stream, "data")));
        });
    });
});
