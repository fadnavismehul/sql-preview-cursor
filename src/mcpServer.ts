import * as vscode from 'vscode';
import { Server } from 'http';
import express from 'express';
import cors from 'cors';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { ResultsViewProvider } from './resultsViewProvider';
import { z } from 'zod';

export class SqlPreviewMcpServer {
  private app: express.Application;
  private server: Server | undefined;
  private mcp: McpServer;
  private transport: SSEServerTransport | undefined;

  constructor(private readonly resultsProvider: ResultsViewProvider) {
    this.app = express();
    this.app.use(cors());

    // Initialize MCP Server
    this.mcp = new McpServer({
      name: 'SQL Preview Extension',
      version: '1.0.0',
    });

    this.setupResources();
    this.setupTools();
  }

  private setupResources() {
    // Resource: List of all tabs
    this.mcp.resource('active-tabs', 'sql-preview://tabs', async uri => {
      const tabs = this.resultsProvider.getTabs();
      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify(tabs, null, 2),
            mimeType: 'application/json',
          },
        ],
      };
    });

    // Resource: Active tab data
    this.mcp.resource('active-tab-data', 'sql-preview://active-tab', async uri => {
      const activeId = this.resultsProvider.getActiveTabId();
      if (!activeId) {
        throw new Error('No active tab selected');
      }
      const data = this.resultsProvider.getTabData(activeId);
      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify(data, null, 2),
            mimeType: 'application/json',
          },
        ],
      };
    });

    // Resource: Specific tab data
    this.mcp.resource(
      'tab-data',
      new ResourceTemplate('sql-preview://tabs/{tabId}/rows', { list: undefined }),
      async (uri, { tabId }) => {
        const data = this.resultsProvider.getTabData(tabId as string);
        if (!data) {
          throw new Error(`Tab not found: ${tabId}`);
        }
        return {
          contents: [
            {
              uri: uri.href,
              text: JSON.stringify(data, null, 2),
              mimeType: 'application/json',
            },
          ],
        };
      }
    );
  }

  private setupTools() {
    // Tool: Run Query
    this.mcp.tool(
      'run_query',
      {
        query: z.string().describe('The SQL query to execute'),
        newTab: z.boolean().default(true).describe('Whether to open results in a new tab'),
      },
      async ({ query, newTab }) => {
        // Execute the command in VS Code
        // We need to pass the query to the command.
        // The existing command might expect a selection or CodeLens,
        // so we might need to update extension.ts to accept a query string argument.
        // Assuming we updated extension.ts or will update it:
        if (newTab) {
          vscode.commands.executeCommand('sql.runQueryNewTab', query);
        } else {
          vscode.commands.executeCommand('sql.runQuery', query);
        }

        return {
          content: [
            {
              type: 'text',
              text: `Query execution initiated. Check VS Code for results.`,
            },
          ],
        };
      }
    );

    // Tool: Get Active Tab Info
    this.mcp.tool('get_active_tab_info', {}, async () => {
      this.resultsProvider.log('Tool get_active_tab_info called');
      const activeId = this.resultsProvider.getActiveTabId();
      this.resultsProvider.log(`Tool retrieved activeId: ${activeId}`);
      if (!activeId) {
        return {
          content: [{ type: 'text', text: 'No active tab.' }],
        };
      }
      const data = this.resultsProvider.getTabData(activeId);
      this.resultsProvider.log(
        `Tool retrieved data for ${activeId}: ${data ? 'Found' : 'Not Found'}`
      );

      try {
        const jsonString = JSON.stringify(
          data,
          (_key, value) => {
            if (typeof value === 'bigint') {
              return value.toString();
            }
            return value;
          },
          2
        );

        return {
          content: [{ type: 'text', text: jsonString }],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.resultsProvider.log(`Error serializing tab data: ${errorMessage}`);
        return {
          content: [{ type: 'text', text: `Error retrieving tab data: ${errorMessage}` }],
          isError: true,
        };
      }
    });
  }

  public async start() {
    const config = vscode.workspace.getConfiguration('sqlPreview');
    const startPort = config.get<number>('mcpPort', 3000);
    const maxRetries = 10;

    // SSE Endpoint
    this.app.get('/sse', async (_req, res) => {
      this.transport = new SSEServerTransport('/messages', res);
      await this.mcp.connect(this.transport);
    });

    // Message Endpoint
    this.app.post('/messages', async (req, res) => {
      if (this.transport) {
        await this.transport.handlePostMessage(req, res);
      } else {
        res.status(500).send('Transport not initialized');
      }
    });

    return new Promise<void>((resolve, reject) => {
      let currentPort = startPort;
      let attempt = 0;

      const tryListen = () => {
        if (attempt > maxRetries) {
          const msg = `MCP Server failed to start after ${maxRetries} attempts. Ports ${startPort}-${currentPort - 1} are in use.`;
          vscode.window.showErrorMessage(msg);
          this.resultsProvider.log(msg);
          reject(new Error(msg));
          return;
        }

        this.resultsProvider.log(`Attempting to start MCP Server on port ${currentPort}...`);

        const server = this.app.listen(currentPort, () => {
          this.server = server;
          this.resultsProvider.log(`MCP Server listening on port ${currentPort}`);
          vscode.window.showInformationMessage(
            `SQL Preview MCP Server running on port ${currentPort}`
          );
          resolve();
        });

        server.on('error', (err: Error & { code?: string }) => {
          if (err.code === 'EADDRINUSE') {
            this.resultsProvider.log(`Port ${currentPort} is in use, trying next port...`);
            currentPort++;
            attempt++;
            server.close(); // Ensure the failed server instance is closed
            tryListen();
          } else {
            vscode.window.showErrorMessage(`MCP Server failed to start: ${err.message}`);
            reject(err);
          }
        });
      };

      tryListen();
    });
  }

  public stop() {
    if (this.server) {
      this.server.close();
    }
  }
}
