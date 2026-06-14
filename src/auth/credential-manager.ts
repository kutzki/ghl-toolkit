/**
 * Credential manager — single source of truth for GHL API credentials.
 *
 * Priority order:
 *   1. GHL_API_KEY env var (static Private Integration Token — no refresh needed)
 *   2. OAuth tokens stored in .ghl-tokens.json (auto-refreshed on expiry)
 *
 * Both main.ts (HTTP server) and server.ts (stdio) use this class so there
 * is exactly one place where "do we have valid credentials?" is decided.
 */

import {
  GHLTokens,
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
} from './oauth.js';
import { TokenStore } from './token-store.js';

export class CredentialManager {
  private tokens: GHLTokens | null = null;
  private tokenStore: TokenStore;
  /** Deduplicates concurrent refresh calls */
  private refreshPromise: Promise<GHLTokens> | null = null;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly redirectUri: string,
  ) {
    this.tokenStore = new TokenStore();
  }

  /**
   * Load persisted tokens from disk.
   * Returns true if we have usable credentials (static key or stored tokens).
   */
  initialize(): boolean {
    if (process.env.GHL_API_KEY) return true;
    this.tokens = this.tokenStore.load();
    return this.tokens !== null;
  }

  isAuthenticated(): boolean {
    return !!(process.env.GHL_API_KEY || this.tokens);
  }

  /** True if GHL_CLIENT_ID and GHL_CLIENT_SECRET are set (OAuth flow available) */
  isOAuthConfigured(): boolean {
    return !!(this.clientId && this.clientSecret);
  }

  /**
   * Returns a valid access token, transparently refreshing if needed.
   * Deduplicates concurrent refresh calls so only one HTTP request is made.
   */
  async getAccessToken(): Promise<string> {
    if (process.env.GHL_API_KEY) return process.env.GHL_API_KEY;

    if (!this.tokens) throw new Error('Not authenticated — no credentials available');

    if (Date.now() < this.tokens.expiresAt) return this.tokens.accessToken;

    // Token is expired — refresh (or join an in-progress refresh)
    if (!this.refreshPromise) {
      this.refreshPromise = refreshAccessToken(
        this.tokens.refreshToken,
        this.clientId,
        this.clientSecret,
      )
        .then((refreshed) => {
          this.tokens = refreshed;
          this.tokenStore.save(refreshed);
          return refreshed;
        })
        .finally(() => {
          this.refreshPromise = null;
        });
    }

    const refreshed = await this.refreshPromise;
    return refreshed.accessToken;
  }

  /** Returns the location ID from env (takes priority) or from stored tokens */
  getLocationId(): string {
    return process.env.GHL_LOCATION_ID || this.tokens?.locationId || '';
  }

  /** Full URL for the GHL OAuth authorization page, bound to a specific state token */
  getAuthorizationUrl(state: string): string {
    return buildAuthorizationUrl(this.clientId, this.redirectUri, state);
  }

  /** Exchange an authorization code for tokens and persist them */
  async handleCallback(code: string): Promise<GHLTokens> {
    const tokens = await exchangeCodeForTokens(
      code,
      this.clientId,
      this.clientSecret,
      this.redirectUri,
    );
    this.tokens = tokens;
    this.tokenStore.save(tokens);
    return tokens;
  }

  /** Structured status for the /auth/status endpoint */
  getStatus(): Record<string, unknown> {
    if (process.env.GHL_API_KEY) {
      return {
        authenticated: true,
        method: 'private_integration_token',
        locationId: this.getLocationId(),
      };
    }
    if (this.tokens) {
      const expiresIn = Math.max(0, Math.round((this.tokens.expiresAt - Date.now()) / 1000));
      return {
        authenticated: true,
        method: 'oauth',
        locationId: this.tokens.locationId,
        companyId: this.tokens.companyId,
        userType: this.tokens.userType,
        expiresIn: `${expiresIn}s`,
        scopes: this.tokens.scopes,
      };
    }
    return { authenticated: false };
  }

  /** Remove stored tokens and revoke the session */
  logout(): void {
    this.tokens = null;
    this.tokenStore.clear();
  }
}
