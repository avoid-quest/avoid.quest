/**
 * User-agent rotation for Instagram API requests
 * Uses mobile user agents that appear to work best with Instagram's API
 */

const USER_AGENTS = [
	"Mozilla/5.0 (Linux; Android 13; SM-S918B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36 Instagram 269.0.0.18.75 Android (33/13; 480dpi; 1080x2316; samsung; SM-S918B; dm3q; qcom; en_US; 436384447)",
	"Mozilla/5.0 (Linux; Android 12; SM-G998B Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/100.0.4896.127 Mobile Safari/537.36 Instagram 216.1.0.21.137 Android (31/12; 420dpi; 1080x2190; samsung; SM-G998B; o1s; exynos2100; en_US; 339281932)",
	"Mozilla/5.0 (Linux; Android 11; Pixel 5 Build/RQ3A.210805.001.A1; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/92.0.4515.159 Mobile Safari/537.36 Instagram 217.0.0.27.359 Android (30/11; 440dpi; 1080x2148; Google/google; Pixel 5; redfin; redfin; en_US; 339650399)",
];

/**
 * Get a random user agent from the pool
 */
export function getRandomUserAgent(): string {
	const index = Math.floor(Math.random() * USER_AGENTS.length);
	return USER_AGENTS[index];
}

/**
 * Get headers for Instagram API requests
 * Includes all necessary headers for successful requests
 */
export function getInstagramHeaders(): Record<string, string> {
	return {
		"User-Agent": getRandomUserAgent(),
		Accept: "*/*",
		"Accept-Language": "en-US,en;q=0.9",
		"Accept-Encoding": "gzip, deflate, br",
		"X-IG-App-ID": "936619743392459",
		"X-ASBD-ID": "198387",
		"X-IG-WWW-Claim": "0",
		"X-Requested-With": "XMLHttpRequest",
		"Sec-Fetch-Dest": "empty",
		"Sec-Fetch-Mode": "cors",
		"Sec-Fetch-Site": "same-origin",
		Referer: "https://www.instagram.com/",
		Origin: "https://www.instagram.com",
	};
}

/**
 * Generate a random delay within a range
 */
export function randomDelay(minMs: number, maxMs: number): number {
	return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

/**
 * Sleep for a specified number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sleep for a random duration within a range
 */
export async function randomSleep(minMs: number, maxMs: number): Promise<void> {
	const delay = randomDelay(minMs, maxMs);
	await sleep(delay);
}
