#!/usr/bin/env node
/**
 * GoHighLevel MCP Server — Stdio Transport
 *
 * Entry point for Claude Desktop and other stdio-based MCP clients.
 * Uses ToolRegistry for automatic tool discovery and routing,
 * keeping it in sync with the HTTP server (main.ts).
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  McpError
} from '@modelcontextprotocol/sdk/types.js';
import * as dotenv from 'dotenv';

import { GHLApiClient } from './clients/ghl-api-client.js';
import { ToolRegistry } from './tool-registry.js';
import { MCPAppsManager } from './apps/index.js';
import { GHLConfig } from './types/ghl-types.js';
import { CredentialManager } from './auth/credential-manager.js';

// Load environment variables
dotenv.config();

/**
 * Main MCP Server class (Stdio transport)
 */
class GHLMCPServer {
  private server: Server;
  private ghlClient: GHLApiClient;
  private registry: ToolRegistry;
  private mcpAppsManager: MCPAppsManager;

  constructor() {
    // Initialize MCP server with capabilities
    this.server = new Server(
      {
        name: 'ghl-mcp-server',
        version: '2.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    // Initialize GHL API client
    this.ghlClient = this.initializeGHLClient();
    
    // Initialize tool registry (auto-discovers all tools)
    this.registry = new ToolRegistry(this.ghlClient);

    // Initialize MCP Apps Manager for rich UI components
    this.mcpAppsManager = new MCPAppsManager(this.ghlClient);

    // Setup MCP handlers
    this.setupHandlers();
  }

  /**
   * Initialize GoHighLevel API client with configuration.
   * Credential priority: GHL_API_KEY env var → stored OAuth tokens (.ghl-tokens.json)
   */
  private initializeGHLClient(): GHLApiClient {
    // Use CredentialManager so we respect stored OAuth tokens as a fallback
    const credManager = new CredentialManager(
      process.env.GHL_CLIENT_ID || '',
      process.env.GHL_CLIENT_SECRET || '',
      process.env.GHL_REDIRECT_URI || 'http://localhost:8000/auth/callback',
    );
    const hasCredentials = credManager.initialize();

    if (!hasCredentials) {
      throw new Error(
        'No credentials found.\n' +
        '  Option A: Set GHL_API_KEY and GHL_LOCATION_ID in your environment.\n' +
        '  Option B: Run the HTTP server (npm start) and visit http://localhost:8000/auth to connect via OAuth.'
      );
    }

    const locationId = credManager.getLocationId();
    if (!locationId) {
      throw new Error(
        'No location ID found. Set GHL_LOCATION_ID in your environment, ' +
        'or re-authenticate via the HTTP server (/auth) to select a sub-account.'
      );
    }

    // For stdio, we use the stored access token synchronously at startup.
    // Auto-refresh is provided via the async getToken callback so long-running
    // stdio processes will keep working past the 24-hour access token expiry.
    const config: GHLConfig = {
      accessToken: process.env.GHL_API_KEY || '',
      baseUrl: process.env.GHL_BASE_URL || 'https://services.leadconnectorhq.com',
      version: '2021-07-28',
      locationId,
    };

    process.stderr.write('[GHL MCP] Initializing GHL API client...\n');
    process.stderr.write(`[GHL MCP] Base URL: ${config.baseUrl}\n`);
    process.stderr.write(`[GHL MCP] Location ID: ${config.locationId}\n`);

    return new GHLApiClient(config, () => credManager.getAccessToken());
  }

  /**
   * Setup MCP request handlers
   */
  private setupHandlers(): void {
    // Handle list resources requests (for MCP Apps)
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      process.stderr.write('[GHL MCP] Listing resources...\n');
      const resourceUris = this.mcpAppsManager.getResourceURIs();
      return {
        resources: resourceUris.map(uri => {
          const handler = this.mcpAppsManager.getResourceHandler(uri);
          return {
            uri,
            name: uri.replace('ui://ghl/', ''),
            mimeType: handler?.mimeType || 'text/html;profile=mcp-app'
          };
        })
      };
    });

    // Handle read resource requests (for MCP Apps)
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      process.stderr.write(`[GHL MCP] Reading resource: ${uri}\n`);

      const handler = this.mcpAppsManager.getResourceHandler(uri);
      if (!handler) {
        throw new McpError(ErrorCode.InvalidRequest, `Resource not found: ${uri}`);
      }

      return {
        contents: [{
          uri,
          mimeType: handler.mimeType,
          text: handler.getContent()
        }]
      };
    });

    // Get all tool definitions from registry + apps
    const registryTools = this.registry.getAllToolDefinitions([]);
    const appTools = this.mcpAppsManager.getToolDefinitions();
    const registeredToolNames = new Set(this.registry.getAllToolNames());
    
    // Filter app tools to avoid duplicates
    const uniqueAppTools = appTools.filter(t => !registeredToolNames.has(t.name));
    const allTools = [...registryTools, ...uniqueAppTools];

    // Handle list tools requests
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      process.stderr.write(`[GHL MCP] Listing ${allTools.length} tools\n`);
      return { tools: allTools };
    });

    // Handle tool execution requests
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      
      process.stderr.write(`[GHL MCP] Executing tool: ${name}\n`);

      try {
        // Check if this is an MCP App tool (returns structuredContent)
        if (this.mcpAppsManager.isAppTool(name)) {
          const appResult = await this.mcpAppsManager.executeTool(name, args || {});
          process.stderr.write(`[GHL MCP] App tool ${name} executed successfully\n`);
          return appResult;
        }

        // Route via registry (handles all GHL tool modules)
        const result = await this.registry.callTool(name, args || {});
        
        if (result === undefined) {
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
        
        process.stderr.write(`[GHL MCP] Tool ${name} executed successfully\n`);
        
        return {
          content: [
            {
              type: 'text',
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error) {
        if (error instanceof McpError) throw error;
        
        const errorMessage = error instanceof Error ? error.message : String(error);
        process.stderr.write(`[GHL MCP] Error executing tool ${name}: ${errorMessage}\n`);
        
        // Determine appropriate error code
        const errorCode = errorMessage.includes('404') 
          ? ErrorCode.InvalidRequest 
          : ErrorCode.InternalError;
        
        throw new McpError(errorCode, `Tool execution failed: ${errorMessage}`);
      }
    });

    process.stderr.write('[GHL MCP] Request handlers setup complete\n');
  }

  /**
   * Test GHL API connection
   */
  private async testGHLConnection(): Promise<void> {
    try {
      process.stderr.write('[GHL MCP] Testing GHL API connection...\n');
      await this.ghlClient.testConnection();
      process.stderr.write('[GHL MCP] ✅ GHL API connection successful\n');
    } catch (error) {
      process.stderr.write(`[GHL MCP] ❌ GHL API connection failed: ${error}\n`);
      throw new Error(`Failed to connect to GHL API: ${error}`);
    }
  }

  /**
   * Initialize and start the MCP server
   */
  async start(): Promise<void> {
    process.stderr.write('🚀 Starting GoHighLevel MCP Server (stdio)...\n');
    process.stderr.write('=====================================\n');
    
    try {
      await this.testGHLConnection();
      
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      
      const toolCount = this.registry.getAllToolNames().length;
      process.stderr.write(`✅ GoHighLevel MCP Server started successfully!\n`);
      process.stderr.write(`🛠️  Tools: ${toolCount}\n`);
      process.stderr.write('🔗 Ready to handle Claude Desktop requests\n');
      process.stderr.write('=====================================\n');
      
    } catch (error) {
      process.stderr.write(`❌ Failed to start GHL MCP Server: ${error}\n`);
      process.exit(1);
    }
  }
}

/**
 * Handle graceful shutdown
 */
function setupGracefulShutdown(): void {
  const shutdown = (signal: string) => {
    process.stderr.write(`\n[GHL MCP] Received ${signal}, shutting down gracefully...\n`);
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    setupGracefulShutdown();
    const server = new GHLMCPServer();
    await server.start();
  } catch (error) {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  }
}

// Start the server
main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
