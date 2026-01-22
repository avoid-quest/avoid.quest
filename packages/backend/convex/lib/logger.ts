/**
 * Logger interface matching @avoid.quest/telegram Logger type
 * Provides consistent logging across the codebase
 */
export type Logger = {
	debug: (message: string) => void;
	info: (message: string) => void;
	warn: (message: string) => void;
	error: (message: string) => void;
};

/**
 * Create a logger for Convex actions/mutations
 * Uses console with consistent formatting that includes timestamp and prefix
 */
export function createLogger(prefix: string): Logger {
	const format = (level: string, msg: string) =>
		`[${new Date().toISOString()}] [${level}] [${prefix}] ${msg}`;

	return {
		debug: (msg) => console.log(format("DEBUG", msg)),
		info: (msg) => console.log(format("INFO", msg)),
		warn: (msg) => console.warn(format("WARN", msg)),
		error: (msg) => console.error(format("ERROR", msg)),
	};
}
