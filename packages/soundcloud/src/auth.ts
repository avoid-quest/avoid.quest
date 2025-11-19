let clientID: string | null = null;
let oauthToken: string | null = null;

/**
 * Set the client_id to access the API with
 */
export function setClientID(id: string | null): void {
  clientID = id;
}

/**
 * Set the oauth_token to access the API with
 *
 * This will be prioritized over a client_id
 */
export function setOauthToken(token: string | null): void {
  oauthToken = token;
}

/**
 * Get the currently set client_id
 */
export function getClientID(): string | null {
  return clientID;
}

/**
 * Get the currently set oauth_token
 */
export function getOauthToken(): string | null {
  return oauthToken;
}
