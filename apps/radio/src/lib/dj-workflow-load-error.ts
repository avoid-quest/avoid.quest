/** The DJ module graph could not load. Recovery requires a new document. */
export class DjWorkflowLoadError extends Error {
  readonly userMessage =
    "Couldn't load DJ mode. Reload to try again. Reloading stops playback.";

  constructor(cause: unknown) {
    super("DJ mode could not load", { cause });
    this.name = "DjWorkflowLoadError";
  }
}
