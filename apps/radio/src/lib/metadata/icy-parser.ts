import { isPublicHttpUrl } from "@/lib/proxy/url-policy";
import { cleanMetadataText, parseRadioTitle } from "./title-parser";

export const MAX_ICY_METAINT = 1024 * 1024;
export const MAX_ICY_METADATA_LENGTH = 4080;
const MAX_ICY_METADATA_BLOCKS = 6;

export type IcyMetadataFields = {
  streamTitle: string | null;
  streamUrl: string | null;
  fields: Record<string, string>;
};

export type ParsedIcyMetadata = {
  title: string | null;
  artist: string | null;
  rawTitle: string | null;
  artworkUrl: string | null;
  fields: Record<string, string>;
};

export function parseIcyMetaInt(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed <= 0 ||
    parsed > MAX_ICY_METAINT
  ) {
    return null;
  }
  return parsed;
}

export function parseIcyMetadataBlock(block: Uint8Array): IcyMetadataFields {
  const text = new TextDecoder("utf-8", { fatal: false })
    .decode(block)
    .replace(/\0+$/g, "");
  const fields: Record<string, string> = {};
  const pattern = /([A-Za-z][A-Za-z0-9_-]*)='([\s\S]*?)';/g;
  let match = pattern.exec(text);

  while (match) {
    const [, key, matchedValue] = match;
    const value = cleanMetadataText(matchedValue);
    if (key) {
      fields[key] = value;
    }
    match = pattern.exec(text);
  }

  return {
    fields,
    // biome-ignore lint/suspicious/noUnnecessaryConditions: ICY metadata fields are sparse at runtime.
    streamTitle: fields.StreamTitle ?? null,
    // biome-ignore lint/suspicious/noUnnecessaryConditions: ICY metadata fields are sparse at runtime.
    streamUrl: fields.StreamUrl ?? null,
  };
}

export function normalizeIcyMetadata(
  metadata: IcyMetadataFields
): ParsedIcyMetadata | null {
  const parsedTitle = parseRadioTitle(metadata.streamTitle);
  const streamUrl = cleanMetadataText(metadata.streamUrl);
  const artworkUrl = streamUrl && isPublicHttpUrl(streamUrl) ? streamUrl : null;

  if (!(parsedTitle.rawTitle || artworkUrl)) {
    return null;
  }

  return {
    ...parsedTitle,
    artworkUrl,
    fields: metadata.fields,
  };
}

function isUsefulIcyMetadataBlock(block: Uint8Array): boolean {
  return normalizeIcyMetadata(parseIcyMetadataBlock(block)) !== null;
}

type IcyReadState = {
  blockIndex: number;
  blockStart: number;
  metadataLength: number | null;
};

function readAvailableIcyMetadataBlock(input: {
  chunks: Uint8Array[];
  metaInt: number;
  received: number;
  state: IcyReadState;
}): Uint8Array | null {
  while (
    input.state.blockIndex < MAX_ICY_METADATA_BLOCKS &&
    input.received > input.state.blockStart
  ) {
    input.state.metadataLength ??=
      getByteAt(input.chunks, input.state.blockStart) * 16;
    if (input.state.metadataLength > MAX_ICY_METADATA_LENGTH) {
      throw new Error("Excessive ICY metadata length");
    }

    const blockEnd = input.state.blockStart + 1 + input.state.metadataLength;
    if (input.received < blockEnd) {
      return null;
    }

    const block = getUsefulIcyMetadataBlock(
      input.chunks,
      input.state.blockStart,
      input.state.metadataLength
    );
    if (block) {
      return block;
    }

    input.state.blockIndex += 1;
    input.state.blockStart = blockEnd + input.metaInt;
    input.state.metadataLength = null;
  }

  return null;
}

function getUsefulIcyMetadataBlock(
  chunks: Uint8Array[],
  blockStart: number,
  metadataLength: number
): Uint8Array | null {
  if (metadataLength <= 0) {
    return null;
  }
  const block = sliceBytes(chunks, blockStart + 1, metadataLength);
  return isUsefulIcyMetadataBlock(block) ? block : null;
}

export async function readFirstIcyMetadataBlock(
  response: Response,
  metaInt: number
): Promise<Uint8Array | null> {
  if (!response.body) {
    return null;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  const state: IcyReadState = {
    blockIndex: 0,
    blockStart: metaInt,
    metadataLength: null,
  };
  try {
    while (state.blockIndex < MAX_ICY_METADATA_BLOCKS) {
      // biome-ignore lint/performance/noAwaitInLoops: stream chunks must be read sequentially
      const { done, value } = await reader.read();
      if (done) {
        return null;
      }
      chunks.push(value);
      received += value.byteLength;

      const block = readAvailableIcyMetadataBlock({
        chunks,
        metaInt,
        received,
        state,
      });
      if (block) {
        return block;
      }
    }
    return null;
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The stream may already be closed by the runtime.
    }
  }
}

function getByteAt(chunks: Uint8Array[], offset: number): number {
  let position = 0;
  for (const chunk of chunks) {
    if (offset < position + chunk.byteLength) {
      return chunk[offset - position] ?? 0;
    }
    position += chunk.byteLength;
  }
  return 0;
}

function sliceBytes(
  chunks: Uint8Array[],
  start: number,
  length: number
): Uint8Array {
  const output = new Uint8Array(length);
  let outputOffset = 0;
  let position = 0;

  for (const chunk of chunks) {
    const chunkStart = Math.max(start - position, 0);
    const chunkEnd = Math.min(start + length - position, chunk.byteLength);
    if (chunkEnd > chunkStart) {
      output.set(chunk.slice(chunkStart, chunkEnd), outputOffset);
      outputOffset += chunkEnd - chunkStart;
    }
    position += chunk.byteLength;
    if (outputOffset >= length) {
      break;
    }
  }

  return output;
}
