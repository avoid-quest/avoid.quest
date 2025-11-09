/** biome-ignore-all lint/complexity/noUselessConstructor: Required for mixin pattern */
/** biome-ignore-all lint/suspicious/noExplicitAny: Required for mixin pattern */
export type FilterCloneOverrides = {
  filters?: BiquadFilterNode[];
};

export abstract class FilterManager {
  constructor(..._args: unknown[]) {
    // Base class for mixins - constructor required for mixin compatibility
  }
  _filters: BiquadFilterNode[] = [];

  addFilter(filter: BiquadFilterNode) {
    this._filters.push(filter);
  }

  removeFilter(filter: BiquadFilterNode) {
    this._filters = this._filters.filter(
      (f) =>
        f.frequency.value !== filter.frequency.value &&
        f.type !== filter.type &&
        f.Q.value !== filter.Q.value &&
        f.gain.value !== filter.gain.value
    );
  }

  applyFilters(connection: AudioNode): AudioNode {
    this._filters.reduce((prevConnection, filter) => {
      prevConnection.connect(filter);
      return filter;
    }, connection);
    return this._filters.length > 0
      ? (this._filters.at(-1) ?? connection)
      : connection;
  }

  get filters() {
    return this._filters;
  }

  addFilters(filters: BiquadFilterNode[]) {
    // todo: be more efficient
    for (const filter of filters) {
      this.addFilter(filter);
    }
  }

  removeFilters(filters: BiquadFilterNode[]) {
    for (const filter of filters) {
      this.removeFilter(filter);
    }
  }

  cleanup(): void {
    // Disconnect all filters before removing them
    for (const filter of this._filters) {
      filter.disconnect();
    }
    this._filters = [];
  }
}
