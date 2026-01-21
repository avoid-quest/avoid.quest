/**
 * Instagram API adapter
 * Handles fetching posts from Instagram's web API
 */

import { getInstagramHeaders, randomSleep } from "./lib/userAgents";

const INSTAGRAM_API_BASE = "https://www.instagram.com/api/v1";
const REQUEST_TIMEOUT_MS = 10000;

/**
 * Fetched post from Instagram
 * Timestamps are in SECONDS (Instagram API format)
 */
export type FetchedPost = {
	id: string;
	shortcode: string;
	timestampSec: number;
	display_url: string;
	caption: string;
	is_video: boolean;
	url: string;
	media_type: "image" | "video" | "carousel";
	media_items: Array<{
		url: string;
		type: "image" | "video" | "thumbnail";
		width?: number;
		height?: number;
	}>;
	video_url?: string;
	thumbnail_url?: string;
};

export type FetchResult = {
	success: boolean;
	posts: FetchedPost[];
	error?: string;
};

type InstagramMediaNode = {
	id: string;
	shortcode?: string;
	code?: string;
	taken_at_timestamp?: number;
	display_url?: string;
	is_video?: boolean;
	video_url?: string;
	edge_media_to_caption?: {
		edges: Array<{ node: { text: string } }>;
	};
	caption?: { text: string };
	edge_sidecar_to_children?: {
		edges: Array<{ node: InstagramMediaNode }>;
	};
	dimensions?: { width: number; height: number };
	display_resources?: Array<{
		src: string;
		config_width: number;
		config_height: number;
	}>;
	video_versions?: Array<{ url: string; width: number; height: number }>;
	image_versions2?: {
		candidates: Array<{ url: string; width: number; height: number }>;
	};
};

type InstagramApiResponse = {
	data?: {
		user?: {
			edge_owner_to_timeline_media?: {
				edges: Array<{ node: InstagramMediaNode }>;
			};
		};
	};
	status?: string;
	message?: string;
};

/**
 * Extract caption text from various Instagram response formats
 */
function extractCaption(node: InstagramMediaNode): string {
	if (node.caption?.text) {
		return node.caption.text;
	}
	if (node.edge_media_to_caption?.edges?.[0]?.node?.text) {
		return node.edge_media_to_caption.edges[0].node.text;
	}
	return "";
}

/**
 * Get the best quality image URL from a media node
 */
function getBestImageUrl(node: InstagramMediaNode): string {
	// Try image_versions2 first (mobile API format)
	if (node.image_versions2?.candidates?.length) {
		const sorted = [...node.image_versions2.candidates].sort(
			(a, b) => b.width - a.width,
		);
		return sorted[0].url;
	}

	// Try display_resources (web API format)
	if (node.display_resources?.length) {
		const sorted = [...node.display_resources].sort(
			(a, b) => b.config_width - a.config_width,
		);
		return sorted[0].src;
	}

	// Fallback to display_url
	return node.display_url ?? "";
}

/**
 * Get video URL from a media node
 */
function getVideoUrl(node: InstagramMediaNode): string | undefined {
	if (node.video_versions?.length) {
		const sorted = [...node.video_versions].sort((a, b) => b.width - a.width);
		return sorted[0].url;
	}
	return node.video_url;
}

/**
 * Get dimensions from a media node
 */
function getDimensions(
	node: InstagramMediaNode,
): { width: number; height: number } | undefined {
	if (node.dimensions) {
		return node.dimensions;
	}
	if (node.image_versions2?.candidates?.[0]) {
		const best = node.image_versions2.candidates[0];
		return { width: best.width, height: best.height };
	}
	if (node.display_resources?.[0]) {
		const best = node.display_resources[0];
		return { width: best.config_width, height: best.config_height };
	}
	return undefined;
}

/**
 * Process a single media node into media items
 */
function processMediaNode(node: InstagramMediaNode): Array<{
	url: string;
	type: "image" | "video" | "thumbnail";
	width?: number;
	height?: number;
}> {
	const items: Array<{
		url: string;
		type: "image" | "video" | "thumbnail";
		width?: number;
		height?: number;
	}> = [];
	const dims = getDimensions(node);

	if (node.is_video) {
		const videoUrl = getVideoUrl(node);
		if (videoUrl) {
			items.push({
				url: videoUrl,
				type: "video",
				width: dims?.width,
				height: dims?.height,
			});
		}
		// Add thumbnail for video
		const thumbnailUrl = getBestImageUrl(node);
		if (thumbnailUrl) {
			items.push({
				url: thumbnailUrl,
				type: "thumbnail",
				width: dims?.width,
				height: dims?.height,
			});
		}
	} else {
		const imageUrl = getBestImageUrl(node);
		if (imageUrl) {
			items.push({
				url: imageUrl,
				type: "image",
				width: dims?.width,
				height: dims?.height,
			});
		}
	}

	return items;
}

/**
 * Parse a media node into a FetchedPost
 */
function parseMediaNode(node: InstagramMediaNode): FetchedPost | null {
	const shortcode = node.shortcode ?? node.code;
	if (!shortcode) return null;

	const timestamp = node.taken_at_timestamp ?? Math.floor(Date.now() / 1000);
	const caption = extractCaption(node);
	const displayUrl = getBestImageUrl(node);

	// Determine media type and collect media items
	let mediaType: "image" | "video" | "carousel" = "image";
	let mediaItems: FetchedPost["media_items"] = [];
	let videoUrl: string | undefined;
	let thumbnailUrl: string | undefined;

	if (node.edge_sidecar_to_children?.edges?.length) {
		// Carousel post
		mediaType = "carousel";
		for (const edge of node.edge_sidecar_to_children.edges) {
			const childItems = processMediaNode(edge.node);
			mediaItems.push(...childItems);
		}
	} else if (node.is_video) {
		// Single video
		mediaType = "video";
		videoUrl = getVideoUrl(node);
		thumbnailUrl = displayUrl;
		mediaItems = processMediaNode(node);
	} else {
		// Single image
		mediaType = "image";
		mediaItems = processMediaNode(node);
	}

	return {
		id: node.id,
		shortcode,
		timestampSec: timestamp,
		display_url: displayUrl,
		caption,
		is_video: node.is_video ?? false,
		url: `https://www.instagram.com/p/${shortcode}/`,
		media_type: mediaType,
		media_items: mediaItems,
		video_url: videoUrl,
		thumbnail_url: thumbnailUrl,
	};
}

/**
 * Fetch posts for a single Instagram user
 */
export async function fetchUserPosts(
	username: string,
	limit: number = 20,
): Promise<FetchResult> {
	const url = `${INSTAGRAM_API_BASE}/users/web_profile_info/?username=${encodeURIComponent(username)}`;

	try {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

		const response = await fetch(url, {
			headers: getInstagramHeaders(),
			signal: controller.signal,
		});

		clearTimeout(timeoutId);

		if (!response.ok) {
			if (response.status === 404) {
				return {
					success: false,
					posts: [],
					error: `User ${username} not found`,
				};
			}
			if (response.status === 429) {
				return {
					success: false,
					posts: [],
					error: "Rate limited by Instagram",
				};
			}
			return {
				success: false,
				posts: [],
				error: `HTTP ${response.status}: ${response.statusText}`,
			};
		}

		const data = (await response.json()) as InstagramApiResponse;

		if (data.status === "fail" || data.message) {
			return {
				success: false,
				posts: [],
				error: data.message ?? "Unknown Instagram API error",
			};
		}

		const edges = data.data?.user?.edge_owner_to_timeline_media?.edges;
		if (!edges) {
			return {
				success: false,
				posts: [],
				error: "No posts found or private account",
			};
		}

		const posts: FetchedPost[] = [];
		for (const edge of edges.slice(0, limit)) {
			const post = parseMediaNode(edge.node);
			if (post) {
				posts.push(post);
			}
		}

		return { success: true, posts };
	} catch (error) {
		if (error instanceof Error) {
			if (error.name === "AbortError") {
				return { success: false, posts: [], error: "Request timeout" };
			}
			return { success: false, posts: [], error: error.message };
		}
		return { success: false, posts: [], error: "Unknown error" };
	}
}

/**
 * Extract shortcode from an Instagram post URL
 */
export function extractShortcode(url: string): string | null {
	const patterns = [
		/instagram\.com\/p\/([A-Za-z0-9_-]+)/,
		/instagram\.com\/reel\/([A-Za-z0-9_-]+)/,
		/instagram\.com\/tv\/([A-Za-z0-9_-]+)/,
	];

	for (const pattern of patterns) {
		const match = url.match(pattern);
		if (match?.[1]) {
			return match[1];
		}
	}

	return null;
}

/**
 * Fetch a single post using the oEmbed API (fallback)
 */
export async function fetchSinglePost(postUrl: string): Promise<FetchResult> {
	const shortcode = extractShortcode(postUrl);
	if (!shortcode) {
		return { success: false, posts: [], error: "Invalid Instagram URL" };
	}

	const oembedUrl = `${INSTAGRAM_API_BASE}/oembed/?url=${encodeURIComponent(postUrl)}`;

	try {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

		const response = await fetch(oembedUrl, {
			headers: getInstagramHeaders(),
			signal: controller.signal,
		});

		clearTimeout(timeoutId);

		if (!response.ok) {
			return {
				success: false,
				posts: [],
				error: `HTTP ${response.status}: ${response.statusText}`,
			};
		}

		const data = (await response.json()) as {
			title?: string;
			thumbnail_url?: string;
			author_name?: string;
		};

		// oEmbed returns limited data, create a minimal post
		const post: FetchedPost = {
			id: shortcode,
			shortcode,
			timestampSec: Math.floor(Date.now() / 1000),
			display_url: data.thumbnail_url ?? "",
			caption: data.title ?? "",
			is_video: false,
			url: postUrl,
			media_type: "image",
			media_items: data.thumbnail_url
				? [{ url: data.thumbnail_url, type: "image" }]
				: [],
		};

		return { success: true, posts: [post] };
	} catch (error) {
		if (error instanceof Error) {
			return { success: false, posts: [], error: error.message };
		}
		return { success: false, posts: [], error: "Unknown error" };
	}
}

/**
 * Fetch posts for multiple users with rate limiting
 * Includes delays between users and between posts
 */
export async function fetchMultipleUsers(
	usernames: string[],
	postsPerUser: number = 20,
	onUserFetched?: (username: string, result: FetchResult) => void,
): Promise<Map<string, FetchResult>> {
	const results = new Map<string, FetchResult>();

	for (let i = 0; i < usernames.length; i++) {
		const username = usernames[i];

		// Delay between users (10-30 seconds)
		if (i > 0) {
			await randomSleep(10000, 30000);
		}

		const result = await fetchUserPosts(username, postsPerUser);
		results.set(username, result);

		if (onUserFetched) {
			onUserFetched(username, result);
		}

		// Small delay after each request (400-900ms)
		await randomSleep(400, 900);
	}

	return results;
}
