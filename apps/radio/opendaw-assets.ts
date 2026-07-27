const UPSTREAM_NAM_ASSET_URL =
  'new URL("@opendaw/nam-wasm/nam.wasm", import.meta.url)';
const PUBLIC_NAM_ASSET_URL =
  'new URL("/opendaw/nam.wasm", globalThis.location.origin)';

export function rewriteOpenDawEngineWorklet(code: string): string {
  const matches = code.split(UPSTREAM_NAM_ASSET_URL).length - 1;
  if (matches !== 1) {
    throw new Error(
      `Expected exactly one openDAW NAM asset URL, received ${matches}`
    );
  }
  return code.replace(UPSTREAM_NAM_ASSET_URL, PUBLIC_NAM_ASSET_URL);
}
