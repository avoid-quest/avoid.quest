const NETWORK_FAILURE =
  /failed to fetch|networkerror|load failed|network request failed/i;
const TRAILING_PERIOD = /\.$/;

/** A file or remote-file load failure, in words for the person loading it. */
export function describeFileLoadFailure(reason: string): string {
  const detail = NETWORK_FAILURE.test(reason)
    ? "the link couldn't be reached"
    : reason.trim().replace(TRAILING_PERIOD, "");
  return `Couldn't load that file: ${detail}`;
}
