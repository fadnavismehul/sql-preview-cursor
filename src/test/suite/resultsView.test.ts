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
    resultsViewProvider = new ResultsViewProvider(vscode.Uri.file('/mock/extension/path'));

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
});
