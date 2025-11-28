import * as vscode from 'vscode';
import { ResultsViewProvider } from '../../resultsViewProvider';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import '../setup';

describe('ResultsViewProvider Persistence', () => {
  let provider: ResultsViewProvider;
  let mockContext: any;
  let mockWebview: any;
  let mockStorageUri: any;

  beforeEach(() => {
    mockStorageUri = {
      fsPath: '/mock/storage',
      scheme: 'file',
      toString: () => 'file:///mock/storage',
    };
    mockContext = {
      extensionUri: { fsPath: '/mock/extension' },
      globalStorageUri: mockStorageUri,
      subscriptions: [],
    };

    mockWebview = {
      webview: {
        options: {},
        html: '',
        onDidReceiveMessage: jest.fn(),
        postMessage: jest.fn(),
        asWebviewUri: jest.fn((uri: any) => uri),
      },
      visible: true,
      onDidDispose: jest.fn(),
      onDidChangeVisibility: jest.fn(),
    };

    // Reset mocks
    (vscode.workspace.fs.writeFile as jest.Mock).mockClear();
    (vscode.workspace.fs.readFile as jest.Mock).mockClear();
    (vscode.workspace.fs.createDirectory as jest.Mock).mockClear();

    provider = new ResultsViewProvider(mockContext.extensionUri, mockContext);
  });

  it('should save state when a tab is created', async () => {
    // Simulate resolving webview to set up the view
    provider.resolveWebviewView(mockWebview);

    // Create a tab
    provider.createTabWithId('tab-1', 'SELECT 1', 'SELECT 1');

    // Check if writeFile was called
    expect(vscode.workspace.fs.writeFile).toHaveBeenCalled();

    const callArgs = (vscode.workspace.fs.writeFile as jest.Mock).mock.calls[0] as any[];
    const fileUri = callArgs[0];
    const content = callArgs[1];

    expect(fileUri.toString()).toContain('tabState.json');

    const savedData = JSON.parse(content.toString());
    expect(savedData.tabs).toBeDefined();
    expect(savedData.tabs.length).toBe(1);
    expect(savedData.tabs[0][1].id).toBe('tab-1');
  });

  it('should load state on initialization', async () => {
    // Mock existing state file
    const mockState = {
      tabs: [
        [
          'tab-old',
          { id: 'tab-old', query: 'SELECT old', title: 'Old Query', status: 'success', rows: [] },
        ],
      ],
      resultCounter: 5,
    };

    (vscode.workspace.fs.readFile as jest.Mock).mockResolvedValue(
      Buffer.from(JSON.stringify(mockState)) as never
    );

    // Re-initialize provider to trigger loadState
    provider = new ResultsViewProvider(mockContext.extensionUri, mockContext);

    // Wait for async loadState
    await new Promise(resolve => setTimeout(resolve, 100));

    provider.resolveWebviewView(mockWebview);

    // Simulate webview loaded message
    const messageHandler = (mockWebview.webview.onDidReceiveMessage as jest.Mock).mock
      .calls[0]![0] as (msg: any) => void;
    messageHandler({ command: 'webviewLoaded' });

    // Check if restore messages were sent
    expect(mockWebview.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'createTab',
        tabId: 'tab-old',
      })
    );
  });

  it('should update state when results are shown', async () => {
    provider.resolveWebviewView(mockWebview);
    provider.createTabWithId('tab-1', 'SELECT 1', 'SELECT 1');

    // Clear previous write calls
    (vscode.workspace.fs.writeFile as jest.Mock).mockClear();

    provider.showResultsForTab('tab-1', {
      columns: [{ name: 'id', type: 'integer' }],
      rows: [[1]],
      query: 'SELECT 1',
      wasTruncated: false,
      totalRowsInFirstBatch: 1,
    });

    expect(vscode.workspace.fs.writeFile).toHaveBeenCalled();
    const content = (vscode.workspace.fs.writeFile as jest.Mock).mock.calls[0]![1] as Buffer;
    const savedData = JSON.parse(content.toString());

    const tabData = new Map(savedData.tabs).get('tab-1') as any;
    expect(tabData.status).toBe('success');
    expect(tabData.rows.length).toBe(1);
  });
});
