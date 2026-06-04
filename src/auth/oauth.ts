/**
 * GHL OAuth 2.0 helpers
 *
 * Handles authorization URL construction, authorization code exchange,
 * and access token refresh for GoHighLevel's OAuth 2.0 flow.
 */

import axios from 'axios';

const GHL_AUTH_BASE = 'https://marketplace.gohighlevel.com';
const GHL_TOKEN_URL = 'https://services.leadconnectorhq.com/oauth/token';

// All scopes needed for full toolkit access
const FULL_SCOPES = [
  'contacts.readonly', 'contacts.write',
  'conversations.readonly', 'conversations.write',
  'conversations/message.readonly', 'conversations/message.write',
  'opportunities.readonly', 'opportunities.write',
  'calendars.readonly', 'calendars.write',
  'calendars/events.readonly', 'calendars/events.write',
  'calendars/groups.readonly', 'calendars/groups.write',
  'payments.readonly',
  'invoices.readonly', 'invoices.write',
  'locations.readonly', 'locations.write',
  'locations/customFields.readonly', 'locations/customFields.write',
  'locations/customValues.readonly', 'locations/customValues.write',
  'locations/tags.readonly', 'locations/tags.write',
  'workflows.readonly',
  'blogs.readonly', 'blogs.write',
  'socialplanner/post.readonly', 'socialplanner/post.write',
  'medias.readonly', 'medias.write',
  'businesses.readonly', 'businesses.write',
  'companies.readonly',
  'users.readonly',
  'funnels.readonly',
].join(' ');

export interface GHLTokens {
  accessToken: string;
  refreshToken: string;
  /** Unix ms timestamp at which the access token expires (with 1-min buffer) */
  expiresAt: number;
  locationId?: string;
  companyId?: string;
  userId?: string;
  /** 'Location' for sub-account tokens, 'Company' for agency tokens */
  userType?: 'Location' | 'Company';
  scopes?: string;
}

export function buildAuthorizationUrl(clientId: string, redirectUri: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    redirect_uri: redirectUri,
    client_id: clientId,
    scope: FULL_SCOPES,
  });
  return `${GHL_AUTH_BASE}/oauth/chooselocation?${params}`;
}

export async function exchangeCodeForTokens(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<GHLTokens> {
  const { data } = await axios.post(
    GHL_TOKEN_URL,
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );

  return tokenFromResponse(data);
}

export async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<GHLTokens> {
  const { data } = await axios.post(
    GHL_TOKEN_URL,
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );

  return tokenFromResponse(data);
}

function tokenFromResponse(data: any): GHLTokens {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    // 1-minute buffer so we refresh before the token actually expires
    expiresAt: Date.now() + data.expires_in * 1000 - 60_000,
    locationId: data.locationId,
    companyId: data.companyId,
    userId: data.userId,
    userType: data.userType,
    scopes: data.scope,
  };
}
