import * as vscode from 'vscode';
import axios from 'axios';
import { mockContext, mockWorkspaceConfig } from '../setup';
import { activate } from '../../extension';
import { Trino } from 'trino-client';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock Trino.create directly
jest.mock('trino-client', () => ({
  Trino: {
    create: jest.fn(),
  },
  BasicAuth: jest.fn().mockImplementation((user, password) => ({ user, password })),
  Client: jest.fn(),
}));

describe('Pagination Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Setup VSCode API mocks
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(mockWorkspaceConfig);
    (vscode.commands.registerCommand as jest.Mock).mockReturnValue({ dispose: jest.fn() });
    (vscode.window.registerWebviewViewProvider as jest.Mock).mockReturnValue({
      dispose: jest.fn(),
    });
    (vscode.languages.registerCodeLensProvider as jest.Mock).mockReturnValue({
      dispose: jest.fn(),
    });

    // Mock configuration
    mockWorkspaceConfig.get.mockImplementation((key: string) => {
      switch (key) {
        case 'maxRowsToDisplay':
          return 100;
        case 'host':
          return 'localhost';
        case 'port':
          return 8080;
        case 'user':
          return 'test';
        case 'ssl':
          return false;
        case 'sslVerify':
          return true;
        default:
          return '';
      }
    });
  });

  test('should fetch multiple pages until maxRowsToDisplay is reached', async () => {
    // Mock initial query response (returns 50 rows with nextUri)
    const mockQueryResponse = {
      id: 'query_123',
      columns: [{ name: 'col1', type: 'varchar' }],
      data: Array(50).fill(['value']), // Note: should be array of arrays, not objects
      nextUri: 'http://localhost:8080/v1/query/123/1',
    };

    // Mock subsequent pages (page 2: 50 more rows, page 3: final rows)
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        data: Array(50).fill(['value2']), // 50 more rows (total: 100)
        nextUri: null, // Stop here since we've reached the limit
      },
    } as any);

    // Setup trino-client mock - query should return a Promise that resolves to an iterator
    const mockTrinoClient = {
      query: jest.fn().mockResolvedValue({
        next: jest.fn().mockResolvedValue({
          value: mockQueryResponse,
          done: false,
        }),
      }),
    };
    (Trino.create as jest.Mock).mockReturnValue(mockTrinoClient);

    // Mock password storage to return a test password
    (mockContext.secrets.get as jest.Mock).mockResolvedValue('test-password');

    // Activate extension
    const context = mockContext as unknown as vscode.ExtensionContext;
    await activate(context);

    // Mock webview view resolution - this is crucial for the ResultsViewProvider to work
    const mockWebviewView = {
      webview: {
        options: {},
        html: '',
        postMessage: jest.fn(),
        onDidReceiveMessage: jest.fn(),
        asWebviewUri: jest.fn(uri => uri),
      },
      show: jest.fn(),
      onDidDispose: jest.fn(),
    };

    // Find the registered webview provider and call resolveWebviewView
    const webviewProviderCalls = (vscode.window.registerWebviewViewProvider as jest.Mock).mock
      .calls;
    const webviewProviderCall = webviewProviderCalls.find(call => call[0] === 'sqlResultsView');
    if (!webviewProviderCall) {
      throw new Error('sqlResultsView webview provider not registered');
    }
    const provider = webviewProviderCall[1];
    provider.resolveWebviewView(mockWebviewView);

    // Get the registered command function and call it directly
    const commandCalls = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    const runQueryCall = commandCalls.find(call => call[0] === 'sql.runCursorQuery');
    if (!runQueryCall) {
      throw new Error('sql.runCursorQuery command not registered');
    }
    const runQueryFunction = runQueryCall[1];

    // Mock text editor and document for the command
    const mockSelection = {
      isEmpty: false,
      active: { line: 0, character: 0 },
    };
    const mockDocument = {
      getText: jest.fn((selection?: any) => {
        if (selection) {
          return 'SELECT * FROM test_table';
        }
        return 'SELECT * FROM test_table';
      }),
      uri: vscode.Uri.file('/mock/file.sql'),
    };
    const mockEditor = {
      document: mockDocument,
      selection: mockSelection,
    };
    (vscode.window as any).activeTextEditor = mockEditor;

    // Execute the command function directly
    await runQueryFunction();

    // Wait longer for async operations to complete
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify initial query was made
    expect(mockTrinoClient.query).toHaveBeenCalled();

    // Verify subsequent pages were fetched (should fetch page 2)
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'http://localhost:8080/v1/query/123/1',
      expect.any(Object)
    );
  });

  test('should stop fetching when maxRowsToDisplay is reached', async () => {
    // Mock maxRowsToDisplay = 75
    mockWorkspaceConfig.get.mockImplementation((key: string) => {
      if (key === 'maxRowsToDisplay') {
        return 75;
      }
      // Call original implementation for other keys
      switch (key) {
        case 'host':
          return 'localhost';
        case 'port':
          return 8080;
        case 'user':
          return 'test';
        case 'ssl':
          return false;
        case 'sslVerify':
          return true;
        default:
          return '';
      }
    });

    // Mock initial query response (50 rows)
    const mockQueryResponse = {
      id: 'query_123',
      columns: [{ name: 'col1', type: 'varchar' }],
      data: Array(50).fill(['value']), // Arrays, not objects
      nextUri: 'http://localhost:8080/v1/query/123/1',
    };

    // Mock page 2 (25 rows, should stop here since we'll reach 75 total)
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        data: Array(25).fill(['value2']), // Only 25 more to reach limit of 75
        nextUri: null, // No more pages needed
      },
    } as any);

    // Setup mocks
    const mockTrinoClient = {
      query: jest.fn().mockReturnValue({
        next: jest.fn().mockResolvedValue({
          value: mockQueryResponse,
          done: false,
        }),
      }),
    };
    (Trino.create as jest.Mock).mockReturnValue(mockTrinoClient);

    // Mock password storage to return a test password
    (mockContext.secrets.get as jest.Mock).mockResolvedValue('test-password');

    // Activate extension
    const context = mockContext as unknown as vscode.ExtensionContext;
    await activate(context);

    // Mock webview view resolution - this is crucial for the ResultsViewProvider to work
    const mockWebviewView = {
      webview: {
        options: {},
        html: '',
        postMessage: jest.fn(),
        onDidReceiveMessage: jest.fn(),
        asWebviewUri: jest.fn(uri => uri),
      },
      show: jest.fn(),
      onDidDispose: jest.fn(),
    };

    // Find the registered webview provider and call resolveWebviewView
    const webviewProviderCalls = (vscode.window.registerWebviewViewProvider as jest.Mock).mock
      .calls;
    const webviewProviderCall = webviewProviderCalls.find(call => call[0] === 'sqlResultsView');
    if (!webviewProviderCall) {
      throw new Error('sqlResultsView webview provider not registered');
    }
    const provider = webviewProviderCall[1];
    provider.resolveWebviewView(mockWebviewView);

    // Get the registered command function and call it directly
    const commandCalls = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    const runQueryCall = commandCalls.find(call => call[0] === 'sql.runCursorQuery');
    if (!runQueryCall) {
      throw new Error('sql.runCursorQuery command not registered');
    }
    const runQueryFunction = runQueryCall[1];

    // Mock text editor and document for the command
    const mockSelection = {
      isEmpty: false,
      active: { line: 0, character: 0 },
    };
    const mockDocument = {
      getText: jest.fn((selection?: any) => {
        if (selection) {
          return 'SELECT * FROM test_table';
        }
        return 'SELECT * FROM test_table';
      }),
      uri: vscode.Uri.file('/mock/file.sql'),
    };
    const mockEditor = {
      document: mockDocument,
      selection: mockSelection,
    };
    (vscode.window as any).activeTextEditor = mockEditor;

    // Execute the command function directly
    await runQueryFunction();

    // Wait longer for async operations to complete
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify we only fetched one additional page
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'http://localhost:8080/v1/query/123/1',
      expect.any(Object)
    );
  });

  test('should handle pagination errors gracefully', async () => {
    // Mock initial successful query
    const mockQueryResponse = {
      id: 'query_123',
      columns: [{ name: 'col1', type: 'varchar' }],
      data: Array(50).fill(['value']), // Arrays, not objects
      nextUri: 'http://localhost:8080/v1/query/123/1',
    };

    // Setup mocks
    const mockTrinoClient = {
      query: jest.fn().mockReturnValue({
        next: jest.fn().mockResolvedValue({
          value: mockQueryResponse,
          done: false,
        }),
      }),
    };
    (Trino.create as jest.Mock).mockReturnValue(mockTrinoClient);

    // Mock axios to fail on pagination request
    mockedAxios.get.mockRejectedValueOnce(new Error('Network error'));

    // Spy on vscode.window.showWarningMessage
    const showWarningMessage = jest.spyOn(vscode.window, 'showWarningMessage');

    // Mock password storage to return a test password
    (mockContext.secrets.get as jest.Mock).mockResolvedValue('test-password');

    // Activate extension
    const context = mockContext as unknown as vscode.ExtensionContext;
    await activate(context);

    // Mock webview view resolution - this is crucial for the ResultsViewProvider to work
    const mockWebviewView = {
      webview: {
        options: {},
        html: '',
        postMessage: jest.fn(),
        onDidReceiveMessage: jest.fn(),
        asWebviewUri: jest.fn(uri => uri),
      },
      show: jest.fn(),
      onDidDispose: jest.fn(),
    };

    // Find the registered webview provider and call resolveWebviewView
    const webviewProviderCalls = (vscode.window.registerWebviewViewProvider as jest.Mock).mock
      .calls;
    const webviewProviderCall = webviewProviderCalls.find(call => call[0] === 'sqlResultsView');
    if (!webviewProviderCall) {
      throw new Error('sqlResultsView webview provider not registered');
    }
    const provider = webviewProviderCall[1];
    provider.resolveWebviewView(mockWebviewView);

    // Get the registered command function and call it directly
    const commandCalls = (vscode.commands.registerCommand as jest.Mock).mock.calls;
    const runQueryCall = commandCalls.find(call => call[0] === 'sql.runCursorQuery');
    if (!runQueryCall) {
      throw new Error('sql.runCursorQuery command not registered');
    }
    const runQueryFunction = runQueryCall[1];

    // Mock text editor and document for the command
    const mockSelection = {
      isEmpty: false,
      active: { line: 0, character: 0 },
    };
    const mockDocument = {
      getText: jest.fn((selection?: any) => {
        if (selection) {
          return 'SELECT * FROM test_table';
        }
        return 'SELECT * FROM test_table';
      }),
      uri: vscode.Uri.file('/mock/file.sql'),
    };
    const mockEditor = {
      document: mockDocument,
      selection: mockSelection,
    };
    (vscode.window as any).activeTextEditor = mockEditor;

    // Execute the command function directly
    await runQueryFunction();

    // Wait longer for async operations to complete
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify error handling
    expect(showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('Failed to fetch all results page 2')
    );

    // Verify we don't try to fetch more pages after error
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });
});
