/**
 * Date extraction types
 * All timestamps are in MILLISECONDS (UTC)
 */

/**
 * Result of date extraction from text
 */
export type ExtractedDate = {
	/** Start date in milliseconds (UTC) */
	start: number;
	/** End date in milliseconds (UTC) - for ranges, otherwise same as start */
	end: number;
	/** The text that was matched */
	matchedText: string;
	/** Index in the original text where match was found */
	index: number;
	/** Whether this was a date range (e.g., "15-17 gennaio") */
	isRange: boolean;
	/** Detected locale of the matched text */
	locale: "it" | "en" | "unknown";
};

/**
 * Options for date extraction
 */
export type ExtractOptions = {
	/**
	 * Reference date for relative dates (e.g., "domani", "next week")
	 * Should be the post's Instagram timestamp
	 * Defaults to Date.now() if not provided
	 */
	referenceDate?: Date | number;
	/**
	 * Timezone for the reference date
	 * @default "Europe/Rome"
	 */
	timezone?: string;
	/**
	 * Whether to use forward-looking date interpretation
	 * When true, "Friday" means next Friday, not last Friday
	 * @default true (events are typically in the future)
	 */
	forwardDate?: boolean;
	/**
	 * Locale priority order for parsing
	 * @default ["it", "en"]
	 */
	localePriority?: Array<"it" | "en">;
};

/**
 * Full extraction result including metadata
 */
export type ExtractionResult = {
	/** Whether a date was found */
	found: boolean;
	/** Extracted date info (null if not found) */
	date: ExtractedDate | null;
	/** Fallback timestamp used when no date found (post timestamp) */
	fallback: number;
};
