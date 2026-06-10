/**
 * GoHighLevel OAuth Tools
 *
 * Only exposes the two verified GHL v2 OAuth endpoints:
 *   - GET /oauth/installedLocations  (requires agency OAuth token)
 *   - POST /oauth/locationToken      (agency → sub-account token exchange)
 *
 * Other OAuth management (app creation, API key CRUD, integration
 * connect/disconnect) is done via the GHL Marketplace App dashboard,
 * not the REST API.
 */

import { GHLApiClient } from '../clients/ghl-api-client.js';

export class OAuthTools {
  constructor(private ghlClient: GHLApiClient) {}

  getToolDefinitions() {
    return [
      {
        name: 'get_installed_locations',
        description:
          'List all sub-account locations where a Marketplace App is installed. ' +
          'Requires an agency-level OAuth token (company userType). ' +
          'Use this to enumerate sub-accounts before exchanging for a location token.',
        inputSchema: {
          type: 'object',
          properties: {
            appId:       { type: 'string', description: 'Marketplace App ID' },
            companyId:   { type: 'string', description: 'Agency/Company ID' },
            skip:        { type: 'number', description: 'Records to skip (pagination)' },
            limit:       { type: 'number', description: 'Max records to return' },
            query:       { type: 'string', description: 'Search by location name' },
            isInstalled: { type: 'boolean', description: 'Filter: true = installed only, false = not installed' },
          },
          required: ['appId', 'companyId'],
        },
        _meta: { labels: { category: 'oauth', access: 'read', complexity: 'simple' } },
      },
      {
        name: 'get_location_access_token',
        description:
          'Exchange an agency OAuth token for a sub-account (location) access token. ' +
          'Useful when you need to act on behalf of a specific sub-account. ' +
          'Requires an agency-level OAuth token (company userType).',
        inputSchema: {
          type: 'object',
          properties: {
            companyId:  { type: 'string', description: 'Agency/Company ID' },
            locationId: { type: 'string', description: 'Target sub-account Location ID' },
          },
          required: ['companyId', 'locationId'],
        },
        _meta: { labels: { category: 'oauth', access: 'read', complexity: 'simple' } },
      },
    ];
  }

  async handleToolCall(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    switch (toolName) {
      case 'get_installed_locations': {
        const params = new URLSearchParams();
        params.append('appId', String(args.appId));
        params.append('companyId', String(args.companyId));
        if (args.skip)        params.append('skip', String(args.skip));
        if (args.limit)       params.append('limit', String(args.limit));
        if (args.query)       params.append('query', String(args.query));
        if (args.isInstalled !== undefined) params.append('isInstalled', String(args.isInstalled));
        return this.ghlClient.makeRequest('GET', `/oauth/installedLocations?${params}`);
      }

      case 'get_location_access_token': {
        return this.ghlClient.makeRequest('POST', `/oauth/locationToken`, {
          companyId:  args.companyId,
          locationId: args.locationId,
        });
      }

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }
}
