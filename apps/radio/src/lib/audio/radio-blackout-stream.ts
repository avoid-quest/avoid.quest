import { connect, type Socket } from "cloudflare:sockets";

const UPSTREAM_HOST = "s.streampunk.cc";
const UPSTREAM_PATH = "/blackout.mp3";
const MAX_RESPONSE_HEADER_BYTES = 64 * 1024;
const HEADER_TERMINATOR = new Uint8Array([13, 10, 13, 10]);

type UpstreamResponseHead = {
  initialBody: Uint8Array;
  status: number;
};

function concatBytes(chunks: readonly Uint8Array[], size: number): Uint8Array {
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

function findHeaderEnd(bytes: Uint8Array): number {
  for (let index = 0; index <= bytes.byteLength - HEADER_TERMINATOR.length; index += 1) {
    if (
      bytes[index] === 13 &&
      bytes[index + 1] === 10 &&
      bytes[index + 2] === 13 &&
      bytes[index + 3] === 10
    ) {
      return index + HEADER_TERMINATOR.length;
    }
  }
  return -1;
}

async function readUpstreamResponseHead(
  reader: ReadableStreamDefaultReader<Uint8Array>
): Promise<UpstreamResponseHead> {
  const chunks: Uint8Array[] = [];
  let size = 0;

  while (size <= MAX_RESPONSE_HEADER_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) {
      throw new Error("Radio BlackOut closed before sending response headers");
    }
    chunks.push(value);
    size += value.byteLength;

    const received = concatBytes(chunks, size);
    const bodyOffset = findHeaderEnd(received);
    if (bodyOffset < 0) {
      continue;
    }

    const head = new TextDecoder().decode(received.subarray(0, bodyOffset));
    const statusLine = head.split("\r\n", 1)[0] ?? "";
    const match = /^(?:HTTP\/\d(?:\.\d)?|ICY)\s+(\d{3})\b/.exec(statusLine);
    if (!match) {
      throw new Error("Radio BlackOut sent an invalid HTTP response");
    }

    return {
      initialBody: received.subarray(bodyOffset),
      status: Number(match[1]),
    };
  }

  throw new Error("Radio BlackOut response headers exceeded the limit");
}

function streamSocketBody(
  socket: Socket,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  initialBody: Uint8Array
): ReadableStream<Uint8Array> {
  let sentInitialBody = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!sentInitialBody) {
        sentInitialBody = true;
        if (initialBody.byteLength > 0) {
          controller.enqueue(initialBody);
          return;
        }
      }

      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        if (value) {
          controller.enqueue(value);
        }
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await reader.cancel().catch(() => undefined);
      await socket.close().catch(() => undefined);
    },
  });
}

function responseHeaders(): Headers {
  return new Headers({
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "Content-Type": "audio/mpeg",
    "X-Content-Type-Options": "nosniff",
  });
}

export async function handleRadioBlackoutStreamRequest(
  request: Request
): Promise<Response> {
  if (request.method === "HEAD") {
    return new Response(null, { headers: responseHeaders() });
  }

  const socket = connect(
    { hostname: UPSTREAM_HOST, port: 443 },
    { allowHalfOpen: true, secureTransport: "on" }
  );

  const closeOnAbort = () => {
    socket.close().catch(() => undefined);
  };
  request.signal.addEventListener("abort", closeOnAbort, { once: true });

  try {
    const writer = socket.writable.getWriter();
    await writer.write(
      new TextEncoder().encode(
        `GET ${UPSTREAM_PATH} HTTP/1.0\r\n` +
          `Host: ${UPSTREAM_HOST}\r\n` +
          "Accept: audio/mpeg,audio/*;q=0.9,*/*;q=0.1\r\n" +
          "Icy-MetaData: 0\r\n" +
          "User-Agent: avoid.quest-radio/1.0\r\n" +
          "Connection: close\r\n\r\n"
      )
    );
    await writer.close();

    const reader = socket.readable.getReader();
    const upstream = await readUpstreamResponseHead(reader);
    if (upstream.status < 200 || upstream.status >= 300) {
      await reader.cancel().catch(() => undefined);
      await socket.close().catch(() => undefined);
      return new Response("Radio BlackOut upstream is unavailable", {
        headers: { "Cache-Control": "no-store" },
        status: 502,
      });
    }

    return new Response(
      streamSocketBody(socket, reader, upstream.initialBody),
      { headers: responseHeaders() }
    );
  } catch (error) {
    await socket.close().catch(() => undefined);
    console.error("[radio-blackout-stream] TCP relay failed", error);
    return new Response("Radio BlackOut upstream is unavailable", {
      headers: { "Cache-Control": "no-store" },
      status: 502,
    });
  }
}
