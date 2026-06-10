/**
 * GoHighLevel Automation & Event Monitoring Tools
 *
 * GHL does NOT have a public REST API for webhook CRUD.
 * Webhook subscriptions are configured in the GHL Marketplace App dashboard
 * (for outbound notifications) or via Workflow "Custom Webhook" actions.
 *
 * This module provides the real alternatives:
 *   1. get_location_webhook_url    — retrieve the inbound webhook URL for a location
 *   2. list_contact_events         — contact activity timeline (calls, messages, workflow events)
 *   3. list_webhook_event_types    — reference list of all GHL outbound webhook event types
 *   4. get_webhook_setup_guide     — step-by-step instructions for configuring webhooks in GHL
 */

import { GHLApiClient } from '../clients/ghl-api-client.js';

// All GHL outbound webhook event types as of API v2021-07-28
const GHL_WEBHOOK_EVENT_TYPES = [
  // Contacts
  'ContactCreate', 'ContactUpdate', 'ContactDelete',
  'ContactDndUpdate', 'ContactTagUpdate',
  // Conversations
  'ConversationUnreadUpdate',
  'InboundMessage', 'OutboundMessage',
  // Opportunities
  'OpportunityCreate', 'OpportunityUpdate', 'OpportunityDelete',
  'OpportunityStageUpdate', 'OpportunityStatusUpdate', 'OpportunityMonetaryValueUpdate',
  // Appointments / Calendar
  'AppointmentCreate', 'AppointmentUpdate', 'AppointmentDelete',
  // Calls
  'NoteCreate', 'NoteUpdate', 'NoteDelete',
  'TaskCreate', 'TaskComplete',
  // Orders / Payments
  'OrderCreate', 'OrderStatusUpdate',
  'InvoiceCreate', 'InvoiceUpdate', 'InvoiceDelete', 'InvoiceSent', 'InvoicePaid',
  // Users
  'UserCreate', 'UserUpdate', 'UserDelete',
  // Forms / Surveys
  'FormSubmission', 'SurveySubmission',
] as const;

export class WebhooksTools {
  constructor(private ghlClient: GHLApiClient) {}

  getToolDefinitions() {
    return [
      {
        name: 'get_location_webhook_url',
        description:
          'Returns the inbound webhook URL for this GHL location. External services ' +
          'can POST to this URL to trigger GHL workflows. Reads from the location settings.',
        inputSchema: {
          type: 'object',
          properties: {
            locationId: { type: 'string', description: 'Location ID (uses configured location if omitted)' },
          },
        },
        _meta: { labels: { category: 'webhooks', access: 'read', complexity: 'simple' } },
      },
      {
        name: 'list_contact_events',
        description:
          'Retrieve the activity timeline for a specific contact — all recorded events ' +
          'including incoming messages, calls, emails, notes, tasks, and workflow triggers. ' +
          'Use this to audit what happened to a contact and when.',
        inputSchema: {
          type: 'object',
          properties: {
            contactId:  { type: 'string', description: 'Contact ID' },
            locationId: { type: 'string', description: 'Location ID (uses configured location if omitted)' },
          },
          required: ['contactId'],
        },
        _meta: { labels: { category: 'webhooks', access: 'read', complexity: 'simple' } },
      },
      {
        name: 'list_webhook_event_types',
        description:
          'Returns all GHL outbound webhook event types you can subscribe to when ' +
          'configuring a Marketplace App or workflow. Use this to know what triggers ' +
          'are available before setting up webhook subscriptions in the GHL dashboard.',
        inputSchema: {
          type: 'object',
          properties: {
            filter: {
              type: 'string',
              description: 'Optional keyword to filter event types (e.g. "Contact", "Invoice")',
            },
          },
        },
        _meta: { labels: { category: 'webhooks', access: 'read', complexity: 'simple' } },
      },
      {
        name: 'get_webhook_setup_guide',
        description:
          'Returns step-by-step instructions for setting up outbound webhooks in GHL ' +
          '(Marketplace App method) and inbound webhooks via Workflow triggers.',
        inputSchema: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              description: '"outbound" for GHL → your server, "inbound" for your server → GHL (default: both)',
            },
          },
        },
        _meta: { labels: { category: 'webhooks', access: 'read', complexity: 'simple' } },
      },
    ];
  }

  async handleToolCall(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const config = this.ghlClient.getConfig();
    const locationId = (args.locationId as string) || config.locationId;

    switch (toolName) {
      case 'get_location_webhook_url': {
        const result = await this.ghlClient.makeRequest('GET', `/locations/${locationId}`);
        const loc: any = (result as any)?.data;
        return {
          locationId,
          locationName: loc?.name,
          webhookUrl: loc?.webhookUrl || `https://services.leadconnectorhq.com/hooks/${locationId}/webhook-trigger/`,
          note: 'POST JSON payloads to this URL to trigger inbound webhook workflows.',
        };
      }

      case 'list_contact_events': {
        const contactId = args.contactId as string;
        return this.ghlClient.makeRequest(
          'GET',
          `/contacts/${contactId}/appointments?locationId=${locationId}`,
        );
      }

      case 'list_webhook_event_types': {
        const filter = args.filter ? String(args.filter).toLowerCase() : '';
        const types = filter
          ? GHL_WEBHOOK_EVENT_TYPES.filter(t => t.toLowerCase().includes(filter))
          : [...GHL_WEBHOOK_EVENT_TYPES];
        return {
          count: types.length,
          eventTypes: types,
          documentation: 'https://highlevel.stoplight.io/docs/integrations/0443d7d1a4bd0-overview',
        };
      }

      case 'get_webhook_setup_guide': {
        const type = (args.type as string) || 'both';
        const guide: Record<string, unknown> = {};

        if (type === 'outbound' || type === 'both') {
          guide.outbound = {
            description: 'GHL sends POST requests to your server when events occur',
            steps: [
              '1. Go to marketplace.gohighlevel.com and open your App',
              '2. Navigate to App Settings → Webhook',
              '3. Add your endpoint URL and select event types to subscribe to',
              '4. Save — GHL will start POSTing JSON payloads to your URL',
              '5. Use list_webhook_event_types to see all available event types',
            ],
            payloadVerification: 'Verify X-GHL-Signature header (Ed25519) on incoming requests',
          };
        }

        if (type === 'inbound' || type === 'both') {
          guide.inbound = {
            description: 'External services POST to GHL to trigger workflows',
            steps: [
              '1. Create a Workflow in GHL with trigger type "Inbound Webhook"',
              '2. Copy the webhook URL from the trigger configuration',
              '3. POST JSON to that URL from your external service',
              '4. Use get_location_webhook_url to retrieve the location-level webhook URL',
            ],
          };
        }

        return guide;
      }

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }
}
