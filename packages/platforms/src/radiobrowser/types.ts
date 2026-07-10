export type RadioBrowserStation = {
  stationUuid: string;
  name: string;
  url: string;
  urlResolved: string;
  homepage: string;
  favicon: string;
  country: string;
  state: string;
  tags: string[];
  codec: string;
  bitrate: number;
  hls: boolean;
  lastCheckOk: boolean;
  lastCheckTime: string;
};

export type RadioBrowserFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export type RadioBrowserSearchOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  limit?: number;
  fetchImpl?: RadioBrowserFetch;
  servers?: readonly string[];
  random?: () => number;
};
