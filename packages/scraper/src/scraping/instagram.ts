import { now } from "@workspace/backend/convex/lib/dateUtils";
import { MOBILE_USER_AGENTS } from "../infra/constants";
import type { Logger } from "../infra/logger";
import { TokenBucketLimiter } from "../infra/rate-limiter";

type MediaItem = {
  url: string;
  type: "image" | "video" | "thumbnail";
  width?: number;
  height?: number;
};

export type ScrapedPost = {
  id: string;
  shortcode: string;
  timestampSec: number;
  display_url: string;
  caption: string;
  is_video: boolean;
  url: string;
  media_type: "image" | "video" | "carousel";
  media_items: MediaItem[];
  video_url?: string;
  thumbnail_url?: string;
};

export type ScraperConfig = {
  minDelayMs: number;
  maxDelayMs: number;
  timeoutMs: number;
  postProcessingDelayMs?: number;
  postProcessingMaxDelayMs?: number;
};

type InstagramApiData = {
  data?: {
    user?: {
      edge_owner_to_timeline_media?: {
        edges?: Array<{
          node: InstagramPostNode;
        }>;
      };
    };
  };
};

type InstagramPostNode = {
  id: string;
  code?: string;
  shortcode?: string;
  taken_at_timestamp?: number;
  taken_at?: number;
  display_url?: string;
  is_video?: boolean;
  video_url?: string;
  caption?: {
    text?: string;
  };
  edge_media_to_caption?: {
    edges?: Array<{
      node: {
        text: string;
      };
    }>;
  };
  image_versions2?: {
    candidates?: Array<{
      url: string;
      width?: number;
      height?: number;
    }>;
  };
  video_versions?: Array<{
    url: string;
    width?: number;
    height?: number;
  }>;
  edge_sidecar_to_children?: {
    edges?: Array<{
      node: {
        display_url?: string;
        video_url?: string;
        video_versions?: Array<{
          url: string;
        }>;
        dimensions?: {
          width?: number;
          height?: number;
        };
      };
    }>;
  };
  dimensions?: {
    width?: number;
    height?: number;
  };
};

const DEFAULT_BURST_CAPACITY = 5;
const DEFAULT_REFILL_RPS = 1;
const DEFAULT_POST_PROCESSING_DELAY_MS = 2000;
const DEFAULT_POST_PROCESSING_MAX_DELAY_MS = 5000;
const DEFAULT_RETRY_DELAY_MIN_MS = 800;
const DEFAULT_RETRY_DELAY_MAX_MS = 1500;
const RESPONSE_PREVIEW_LENGTH = 120;
const MS_PER_SECOND = 1000;

const VIDEO_THUMBNAIL_PATTERN = /\.(jpe?g|png|heic)$/i;
const POST_SHORTCODE_PATTERN = /instagram\.com\/p\/([a-zA-Z0-9_-]+)/;
const HTTP_STATUS_PATTERN = /HTTP (\d+)/;

type InstagramOEmbedResponse = {
  version: string;
  type: string;
  title: string;
  author_name: string;
  author_url: string;
  provider_name: string;
  provider_url: string;
  thumbnail_url: string;
  thumbnail_width: number;
  thumbnail_height: number;
  html: string;
  width: number;
  height: number;
};

export type SinglePostResponse = {
  success: boolean;
  post?: ScrapedPost;
  username?: string;
  scraped_at?: string;
  error?: string;
  code?: string;
  statusCode?: number;
};

export class InstagramScraper {
  private readonly config: ScraperConfig;
  private readonly limiter: TokenBucketLimiter;
  private readonly logger?: Logger;

  constructor(
    config?: Partial<ScraperConfig>,
    opts?: { limiter?: TokenBucketLimiter; logger?: Logger }
  ) {
    this.config = {
      minDelayMs: 400,
      maxDelayMs: 900,
      timeoutMs: 10_000,
      postProcessingDelayMs: DEFAULT_POST_PROCESSING_DELAY_MS,
      postProcessingMaxDelayMs: DEFAULT_POST_PROCESSING_MAX_DELAY_MS,
      ...config,
    } as ScraperConfig;
    this.limiter =
      opts?.limiter ??
      new TokenBucketLimiter(DEFAULT_BURST_CAPACITY, DEFAULT_REFILL_RPS);
    this.logger = opts?.logger;
  }

  private delay(min: number, max: number): Promise<void> {
    const t = Math.floor(Math.random() * (max - min + 1) + min);
    return new Promise((r) => setTimeout(r, t));
  }

  private getRandomHeaders(): Record<string, string> {
    const uaIndex = Math.floor(Math.random() * MOBILE_USER_AGENTS.length);
    const ua = MOBILE_USER_AGENTS[uaIndex];
    if (!ua) {
      throw new Error("No user agents available");
    }
    return {
      "User-Agent": ua,
      Accept: "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      Connection: "keep-alive",
      "X-IG-App-ID": "936619743392459",
      "X-ASBD-ID": "198387",
      "X-IG-WWW-Claim": "0",
      "X-Requested-With": "XMLHttpRequest",
      Referer: "https://www.instagram.com/",
      Origin: "https://www.instagram.com",
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Dest": "empty",
    };
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      await this.limiter.removeTokens(1);
      const res = await fetch(url, {
        method: "GET",
        headers: this.getRandomHeaders(),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const contentType = res.headers.get("content-type");
      if (!contentType?.includes("application/json")) {
        const text = await res.text();
        throw new Error(
          `Invalid response: ${contentType ?? "unknown"} ${text.slice(0, RESPONSE_PREVIEW_LENGTH)}`
        );
      }
      const json = (await res.json()) as T;
      return json;
    } finally {
      clearTimeout(id);
    }
  }

  private addDisplayUrlMedia(
    mediaItems: MediaItem[],
    node: InstagramPostNode
  ): void {
    const displayUrl =
      node.display_url || node.image_versions2?.candidates?.[0]?.url || "";
    if (displayUrl) {
      mediaItems.push({
        url: displayUrl,
        type: node.is_video ? "thumbnail" : "image",
      });
    }
  }

  private addVideoMedia(mediaItems: MediaItem[], videoUrl?: string): void {
    if (videoUrl && !VIDEO_THUMBNAIL_PATTERN.test(videoUrl)) {
      mediaItems.push({ url: videoUrl, type: "video" });
    }
  }

  private extractCarouselMedia(
    mediaItems: MediaItem[],
    node: InstagramPostNode
  ): void {
    if (!node.edge_sidecar_to_children?.edges) {
      return;
    }
    for (const edge of node.edge_sidecar_to_children.edges) {
      const child = edge.node;
      if (child.display_url) {
        const hasVideo = child.video_versions?.[0]?.url || child.video_url;
        mediaItems.push({
          url: child.display_url,
          type: hasVideo ? "thumbnail" : "image",
        });
        const v = child.video_versions?.[0]?.url || child.video_url;
        if (v) {
          this.addVideoMedia(mediaItems, v);
        }
      }
    }
  }

  private extractMediaItems(node: InstagramPostNode): MediaItem[] {
    const mediaItems: MediaItem[] = [];
    this.addDisplayUrlMedia(mediaItems, node);
    const videoUrl = node.video_versions?.[0]?.url || node.video_url;
    if (videoUrl) {
      this.addVideoMedia(mediaItems, videoUrl);
    }
    this.extractCarouselMedia(mediaItems, node);
    return mediaItems;
  }

  private determineMediaType(
    node: InstagramPostNode,
    mediaItemsCount: number
  ): "image" | "video" | "carousel" {
    if (node.is_video) {
      return "video";
    }
    if (
      mediaItemsCount > 1 ||
      (node.edge_sidecar_to_children?.edges?.length ?? 0) > 1
    ) {
      return "carousel";
    }
    return "image";
  }

  private extractCaption(node: InstagramPostNode): string {
    return (
      node.edge_media_to_caption?.edges?.[0]?.node?.text ||
      node.caption?.text ||
      ""
    );
  }

  private extractTimestamp(node: InstagramPostNode): number {
    // Instagram API returns timestamps in seconds
    // Return as-is (seconds) - will be converted to milliseconds in backend
    return (
      node.taken_at_timestamp ||
      node.taken_at ||
      Math.floor(now() / MS_PER_SECOND)
    );
  }

  private processNode(node: InstagramPostNode): ScrapedPost {
    const mediaItems = this.extractMediaItems(node);
    const mediaType = this.determineMediaType(node, mediaItems.length);
    const caption = this.extractCaption(node);
    const timestampSec = this.extractTimestamp(node);
    const shortcode = node.code || node.shortcode || "";
    const displayUrl =
      node.display_url || node.image_versions2?.candidates?.[0]?.url || "";

    const post: ScrapedPost = {
      id: String(node.id),
      shortcode,
      timestampSec,
      display_url: displayUrl,
      caption,
      is_video: !!node.is_video,
      url: `https://www.instagram.com/p/${shortcode}/`,
      media_type: mediaType,
      media_items: mediaItems,
    };

    const video = mediaItems.find((m) => m.type === "video");
    const thumb = mediaItems.find((m) => m.type === "thumbnail");
    if (video) {
      post.video_url = video.url;
    }
    if (thumb) {
      post.thumbnail_url = thumb.url;
    }

    return post;
  }

  async getRecent(username: string, limit: number): Promise<ScrapedPost[]> {
    await this.delay(this.config.minDelayMs, this.config.maxDelayMs);
    let data: InstagramApiData;
    try {
      data = await this.fetchJson<InstagramApiData>(
        `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`
      );
    } catch (e) {
      this.logger?.warn(`Fetch failed, retrying once: ${String(e)}`);
      await this.delay(DEFAULT_RETRY_DELAY_MIN_MS, DEFAULT_RETRY_DELAY_MAX_MS);
      data = await this.fetchJson<InstagramApiData>(
        `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`
      );
    }

    const nodes: InstagramPostNode[] =
      data?.data?.user?.edge_owner_to_timeline_media?.edges?.map(
        (e) => e.node
      ) || [];
    const posts: ScrapedPost[] = [];
    const postDelayMin =
      this.config.postProcessingDelayMs ?? DEFAULT_POST_PROCESSING_DELAY_MS;
    const postDelayMax =
      this.config.postProcessingMaxDelayMs ??
      DEFAULT_POST_PROCESSING_MAX_DELAY_MS;

    for (const node of nodes.slice(0, limit)) {
      await this.delay(postDelayMin, postDelayMax);
      posts.push(this.processNode(node));
    }

    return posts;
  }

  private extractShortcodeFromUrl(url: string): string | null {
    const match = url.match(POST_SHORTCODE_PATTERN);
    return match?.[1] ?? null;
  }

  private async fetchOEmbedData(url: string): Promise<InstagramOEmbedResponse> {
    const oembedUrl = `https://www.instagram.com/api/v1/oembed/?url=${encodeURIComponent(url)}`;
    await this.delay(this.config.minDelayMs, this.config.maxDelayMs);
    return await this.fetchJson<InstagramOEmbedResponse>(oembedUrl);
  }

  private processOEmbedData(
    oembedData: InstagramOEmbedResponse,
    shortcode: string
  ): ScrapedPost {
    const mediaItems: MediaItem[] = [];

    // Extract thumbnail as the main media item
    if (oembedData.thumbnail_url) {
      mediaItems.push({
        url: oembedData.thumbnail_url,
        type: "image",
        width: oembedData.thumbnail_width,
        height: oembedData.thumbnail_height,
      });
    }

    // Determine media type based on oEmbed data
    let mediaType: "image" | "video" | "carousel" = "image";
    if (oembedData.type === "video") {
      mediaType = "video";
    }

    const caption = oembedData.title || "";
    const timestamp = Math.floor(now() / MS_PER_SECOND);
    const isVideo = oembedData.type === "video";

    const post: ScrapedPost = {
      id: shortcode,
      shortcode,
      timestampSec: timestamp,
      display_url: oembedData.thumbnail_url || "",
      caption,
      is_video: isVideo,
      url: `https://www.instagram.com/p/${shortcode}/`,
      media_type: mediaType,
      media_items: mediaItems,
    };

    if (isVideo && oembedData.thumbnail_url) {
      post.thumbnail_url = oembedData.thumbnail_url;
    }

    return post;
  }

  private handleSinglePostError(error: unknown): SinglePostResponse {
    if (!(error instanceof Error)) {
      return {
        success: false,
        error: "Unknown error occurred",
        code: "UNKNOWN_ERROR",
      };
    }

    // Check for HTTP errors
    if (error.message.includes("HTTP")) {
      const statusMatch = error.message.match(HTTP_STATUS_PATTERN);
      const statusCode = statusMatch?.[1]
        ? Number.parseInt(statusMatch[1], 10)
        : undefined;
      return {
        success: false,
        error: error.message,
        code: "HTTP_ERROR",
        statusCode,
      };
    }

    // Check for timeout
    if (error.name === "AbortError") {
      return {
        success: false,
        error: "Request timed out",
        code: "TIMEOUT",
        statusCode: 408,
      };
    }

    return {
      success: false,
      error: error.message,
      code: "NETWORK_ERROR",
    };
  }

  async getSinglePost(postUrl: string): Promise<SinglePostResponse> {
    if (!postUrl) {
      return {
        success: false,
        error: "Post URL is required",
        code: "INVALID_URL",
      };
    }

    // Extract shortcode from URL
    const shortcode = this.extractShortcodeFromUrl(postUrl);
    if (!shortcode) {
      return {
        success: false,
        error: "Invalid Instagram post URL format",
        code: "INVALID_URL",
      };
    }

    try {
      // Fetch post data using oEmbed API
      let oembedData: InstagramOEmbedResponse;
      try {
        oembedData = await this.fetchOEmbedData(postUrl);
      } catch (e) {
        // Retry once on failure
        this.logger?.warn(`OEmbed fetch failed, retrying once: ${String(e)}`);
        await this.delay(
          DEFAULT_RETRY_DELAY_MIN_MS,
          DEFAULT_RETRY_DELAY_MAX_MS
        );
        oembedData = await this.fetchOEmbedData(postUrl);
      }

      if (!oembedData) {
        return {
          success: false,
          error: "Failed to fetch post data",
          code: "PARSE_ERROR",
        };
      }

      // Process the data into our standard format
      const processedPost = this.processOEmbedData(oembedData, shortcode);

      // Extract username from oEmbed author_name
      const username = oembedData.author_name || undefined;

      return {
        success: true,
        post: processedPost,
        username,
        scraped_at: new Date(now()).toISOString(),
      };
    } catch (error) {
      return this.handleSinglePostError(error);
    }
  }
}
