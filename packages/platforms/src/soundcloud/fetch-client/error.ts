export class ClientFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientFetchError";
  }
}
