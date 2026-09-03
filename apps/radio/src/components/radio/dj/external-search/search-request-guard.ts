export function createSearchRequestGuard() {
  let context = "";
  let generation = 0;

  return {
    begin(requestContext: string): () => boolean {
      const requestGeneration = ++generation;
      return () =>
        requestGeneration === generation && requestContext === context;
    },
    setContext(nextContext: string): void {
      if (context !== nextContext) {
        generation += 1;
      }
      context = nextContext;
    },
  };
}
