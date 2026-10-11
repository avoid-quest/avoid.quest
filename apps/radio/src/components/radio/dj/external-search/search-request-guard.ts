export function createSearchRequestGuard() {
  let context = "";
  let generation = 0;

  return {
    begin(requestContext: string): () => boolean {
      generation += 1;
      const requestGeneration = generation;
      return () =>
        requestGeneration === generation && requestContext === context;
    },
    invalidate(): void {
      generation += 1;
    },
    setContext(nextContext: string): void {
      if (context !== nextContext) {
        generation += 1;
      }
      context = nextContext;
    },
  };
}
