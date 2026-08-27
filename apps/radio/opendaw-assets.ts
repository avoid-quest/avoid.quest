const UPSTREAM_NAM_ASSET_URL =
  'new URL("@opendaw/nam-wasm/nam.wasm", import.meta.url)';
const PUBLIC_NAM_ASSET_URL =
  'new URL("/opendaw/nam.wasm", globalThis.location.origin)';
const UPSTREAM_TIMING_START = "let i=this.#I?this.#i.start():0";
const SYNCHRONOUS_TIMING_START =
  "let i=this.#I?(globalThis.performance?.now()??Date.now()):0";
const UPSTREAM_TIMING_END =
  "this.#I&&(this.#i.end(),this.#n[this.#T]=i,this.#T=(this.#T+1)%hw)";
const SYNCHRONOUS_TIMING_END =
  "this.#I&&(this.#n[this.#T]=(globalThis.performance?.now()??Date.now())-i,this.#T=(this.#T+1)%hw)";

function replaceExactlyOnce(
  code: string,
  upstream: string,
  replacement: string,
  label: string
): string {
  const matches = code.split(upstream).length - 1;
  if (matches !== 1) {
    throw new Error(
      `Expected exactly one openDAW ${label}, received ${matches}`
    );
  }
  return code.replace(upstream, replacement);
}

export function rewriteOpenDawEngineWorklet(code: string): string {
  const matches = code.split(UPSTREAM_NAM_ASSET_URL).length - 1;
  if (matches !== 1) {
    throw new Error(
      `Expected exactly one openDAW NAM asset URL, received ${matches}`
    );
  }
  return code.replace(UPSTREAM_NAM_ASSET_URL, PUBLIC_NAM_ASSET_URL);
}

export function rewriteOpenDawWasmProcessorTiming(code: string): string {
  return replaceExactlyOnce(
    replaceExactlyOnce(
      code,
      UPSTREAM_TIMING_START,
      SYNCHRONOUS_TIMING_START,
      "timing start"
    ),
    UPSTREAM_TIMING_END,
    SYNCHRONOUS_TIMING_END,
    "timing end"
  );
}
