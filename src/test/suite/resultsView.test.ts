import * as vscode from 'vscode';
import { mockWebviewPanel } from '../setup';
import { ResultsViewProvider } from '../../resultsViewProvider';

describe('ResultsViewProvider Tests', () => {
  let resultsViewProvider: ResultsViewProvider;
  let mockWebviewView: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create a mock webview view that includes the mock webview panel
    mockWebviewView = {
      webview: mockWebviewPanel.webview,
      show: jest.fn(),
      onDidDispose: jest.fn(),
    };

    // Create with extension Uri
    const mockContext = {
      extensionUri: vscode.Uri.file('/mock/extension/path'),
      globalStorageUri: vscode.Uri.file('/mock/storage/path'),
      subscriptions: [],
    } as any;
    resultsViewProvider = new ResultsViewProvider(
      vscode.Uri.file('/mock/extension/path'),
      mockContext
    );

    // Manually trigger the resolveWebviewView to set up the internal _view
    resultsViewProvider.resolveWebviewView(mockWebviewView);
  });

  test('should show results with truncation warning when results exceed maxRowsToDisplay', async () => {
    // Mock data
    const columns = [{ name: 'col1', type: 'varchar' }];
    const rows = Array(600).fill(['value']); // More than default maxRowsToDisplay
    const data = {
      columns,
      rows,
      query: 'SELECT * FROM test_table',
      wasTruncated: true,
      totalRowsInFirstBatch: 600,
      queryId: 'query_123',
      nextUri: 'http://localhost:8080/v1/query/123/next',
    };

    // Show results
    resultsViewProvider.showResults(data);

    // Verify webview was updated
    expect(mockWebviewPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'resultData',
      data,
    });
  });

  test('should show results without truncation warning when results within limit', async () => {
    // Mock data
    const columns = [{ name: 'col1', type: 'varchar' }];
    const rows = Array(300).fill(['value']); // Less than default maxRowsToDisplay
    const data = {
      columns,
      rows,
      query: 'SELECT * FROM test_table',
      wasTruncated: false,
      totalRowsInFirstBatch: 300,
      queryId: 'query_123',
      // nextUri is undefined by default
    };

    // Show results
    resultsViewProvider.showResults(data);

    // Verify webview was updated
    expect(mockWebviewPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'resultData',
      data,
    });
  });

  test('should show results for specific tab', async () => {
    // Mock data
    const tabId = 'tab-123';
    const columns = [{ name: 'col1', type: 'varchar' }];
    const rows = [['value']];
    const data = {
      columns,
      rows,
      query: 'SELECT * FROM specific_tab',
      wasTruncated: false,
      totalRowsInFirstBatch: 1,
      queryId: 'query_123',
    };

    // Show results for tab
    resultsViewProvider.showResultsForTab(tabId, data);

    // Verify webview was updated with correct structure
    expect(mockWebviewPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'resultData',
      tabId,
      data,
      title: 'Query Results',
    });
  });

  test('should handle empty results', async () => {
    // Mock data
    const columns = [{ name: 'col1', type: 'varchar' }];
    const rows: any[][] = [];
    const data = {
      columns,
      rows,
      query: 'SELECT * FROM empty_table',
      wasTruncated: false,
      totalRowsInFirstBatch: 0,
      queryId: 'query_123',
      // nextUri is undefined by default
    };

    // Show results
    resultsViewProvider.showResults(data);

    // Verify webview was updated
    expect(mockWebviewPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'resultData',
      data,
    });
  });

  test('should handle error messages', async () => {
    const errorMessage = 'Query failed: syntax error';
    const errorDetails = 'line 1:10: Table not found';

    // Show error
    resultsViewProvider.showError(errorMessage, errorDetails);

    // Verify webview was updated
    expect(mockWebviewPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'queryError',
      error: {
        message: errorMessage,
        details: errorDetails,
      },
    });
  });

  test('should show loading state', async () => {
    // Show loading
    resultsViewProvider.showLoading();

    // Verify webview was updated
    expect(mockWebviewPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'showLoading',
    });
  });

  test('should show status messages', async () => {
    const message = 'Query completed successfully';

    // Show status
    resultsViewProvider.showStatusMessage(message);

    // Verify webview was updated
    expect(mockWebviewPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'statusMessage',
      message,
    });
  });

  test('should create a new tab', async () => {
    const query = 'SELECT * FROM new_tab';
    const title = 'New Query Tab';

    resultsViewProvider.createTab(query, title);

    expect(mockWebviewPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'createTab',
      query,
      title,
    });
  });

  test('should create a new tab with specific ID', async () => {
    const tabId = 'tab-custom-id';
    const query = 'SELECT * FROM custom_id';
    const title = 'Custom ID Tab';

    resultsViewProvider.createTabWithId(tabId, query, title);

    expect(mockWebviewPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'createTab',
      tabId,
      query,
      title,
    });
  });

  test('should get or create active tab ID', async () => {
    const query = 'SELECT * FROM active_tab';
    const title = 'Active Tab';

    // Scenario 1: No active tab exists -> Should create new tab
    const tabId = resultsViewProvider.getOrCreateActiveTabId(query, title);

    expect(tabId).not.toBe('active-tab-placeholder');
    expect(tabId).toMatch(/^tab-/);

    // Should call createTabWithId internally, which sends createTab message
    expect(mockWebviewPanel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'createTab',
        tabId: tabId,
        query,
        title,
      })
    );

    // Scenario 2: Active tab exists -> Should reuse it
    const reusedTabId = resultsViewProvider.getOrCreateActiveTabId(
      'SELECT * FROM reused',
      'Reused Tab'
    );
    expect(reusedTabId).toBe(tabId);

    expect(mockWebviewPanel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'reuseOrCreateActiveTab',
        query: 'SELECT * FROM reused',
        title: 'Reused Tab',
      })
    );
  });

  test('should close active tab', async () => {
    resultsViewProvider.closeActiveTab();

    expect(mockWebviewPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'closeActiveTab',
    });
  });

  test('should close other tabs', async () => {
    resultsViewProvider.closeOtherTabs();

    expect(mockWebviewPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'closeOtherTabs',
    });
  });

  test('should close all tabs', async () => {
    resultsViewProvider.closeAllTabs();

    expect(mockWebviewPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'closeAllTabs',
    });
  });

  test('should create tab with source file URI', () => {
    const sourceUri = 'file:///path/to/script.sql';

    resultsViewProvider.createTabWithId('tab-1', 'SELECT 1', 'Preview', sourceUri);

    expect(mockWebviewPanel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'createTab',
        tabId: 'tab-1',
        sourceFileUri: sourceUri,
      })
    );
  });

  test('should filter tabs when active editor changes', () => {
    // Since we mocked window.onDidChangeActiveTextEditor, we can't easily trigger the real event.
    // However, we can call the private method _filterTabsByFile via casting.
    (resultsViewProvider as any)._filterTabsByFile('file:///path/to/script.sql');

    expect(mockWebviewPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'filterTabs',
      fileUri: 'file:///path/to/script.sql',
    });
  });
});
