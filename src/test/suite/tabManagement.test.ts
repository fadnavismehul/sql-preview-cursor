import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { ResultsViewProvider } from '../../resultsViewProvider';

describe('Tab Management Tests', () => {
  let resultsViewProvider: ResultsViewProvider;
  let mockContext: vscode.ExtensionContext;
  let mockWebviewView: vscode.WebviewView;
  let mockWebview: vscode.Webview;
  let postMessageStub: sinon.SinonStub;

  beforeEach(() => {
    // Create mock extension context
    mockContext = {
      extensionUri: vscode.Uri.file('/mock/extension/path'),
      secrets: {
        get: sinon.stub(),
        store: sinon.stub(),
        delete: sinon.stub(),
      },
      subscriptions: [],
    } as any;

    // Create mock webview
    postMessageStub = sinon.stub();
    mockWebview = {
      postMessage: postMessageStub,
      asWebviewUri: sinon.stub().returns(vscode.Uri.file('/mock/webview/resource')),
      cspSource: 'vscode-resource:',
      html: '',
      onDidReceiveMessage: sinon.stub(),
      options: {},
    } as any;

    // Create mock webview view
    mockWebviewView = {
      webview: mockWebview,
      show: sinon.stub(),
      onDidDispose: sinon.stub(),
    } as any;

    // Create results view provider
    resultsViewProvider = new ResultsViewProvider(mockContext.extensionUri);
    resultsViewProvider.resolveWebviewView(mockWebviewView);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('Tab Creation and Management', () => {
    test('createTabWithId should create tab with specific ID', () => {
      const tabId = 'test-tab-123';
      const query = 'SELECT * FROM test';
      const title = 'Test Query';

      resultsViewProvider.createTabWithId(tabId, query, title);

      assert.ok(postMessageStub.calledOnce);
      const message = postMessageStub.firstCall.args[0];
      assert.strictEqual(message.type, 'createTab');
      assert.strictEqual(message.tabId, tabId);
      assert.strictEqual(message.query, query);
      assert.strictEqual(message.title, title);
    });

    test('getOrCreateActiveTabId should request active tab from webview', () => {
      const query = 'SELECT * FROM test';
      const title = 'Test Query';

      const tabId = resultsViewProvider.getOrCreateActiveTabId(query, title);

      assert.ok(postMessageStub.calledOnce);
      const message = postMessageStub.firstCall.args[0];
      assert.strictEqual(message.type, 'reuseOrCreateActiveTab');
      assert.strictEqual(message.query, query);
      assert.strictEqual(message.title, title);
      assert.ok(typeof tabId === 'string');
      assert.ok(tabId.length > 0);
    });

    test('closeActiveTab should send closeActiveTab message', () => {
      resultsViewProvider.closeActiveTab();

      assert.ok(postMessageStub.calledOnce);
      const message = postMessageStub.firstCall.args[0];
      assert.strictEqual(message.type, 'closeActiveTab');
    });

    test('closeOtherTabs should send closeOtherTabs message', () => {
      resultsViewProvider.closeOtherTabs();

      assert.ok(postMessageStub.calledOnce);
      const message = postMessageStub.firstCall.args[0];
      assert.strictEqual(message.type, 'closeOtherTabs');
    });

    test('closeAllTabs should send closeAllTabs message', () => {
      resultsViewProvider.closeAllTabs();

      assert.ok(postMessageStub.calledOnce);
      const message = postMessageStub.firstCall.args[0];
      assert.strictEqual(message.type, 'closeAllTabs');
    });
  });

  describe('Tab Loading and Results', () => {
    test('showLoadingForTab should show loading for specific tab', () => {
      const tabId = 'test-tab-123';
      const query = 'SELECT * FROM test';
      const title = 'Test Query';

      resultsViewProvider.showLoadingForTab(tabId, query, title);

      assert.ok(postMessageStub.calledOnce);
      const message = postMessageStub.firstCall.args[0];
      assert.strictEqual(message.type, 'showLoading');
      assert.strictEqual(message.tabId, tabId);
      assert.strictEqual(message.query, query);
      assert.strictEqual(message.title, title);
    });

    test('showResultsForTab should show results for specific tab', () => {
      const tabId = 'test-tab-123';
      const data = {
        columns: [
          { name: 'id', type: 'integer' },
          { name: 'name', type: 'varchar' },
        ],
        rows: [
          [1, 'Alice'],
          [2, 'Bob'],
        ],
        query: 'SELECT * FROM users',
        wasTruncated: false,
        totalRowsInFirstBatch: 2,
      };

      resultsViewProvider.showResultsForTab(tabId, data);

      assert.ok(postMessageStub.calledOnce);
      const message = postMessageStub.firstCall.args[0];
      assert.strictEqual(message.type, 'resultData');
      assert.strictEqual(message.tabId, tabId);
      assert.deepStrictEqual(message.data, data);
    });

    test('showErrorForTab should show error for specific tab', () => {
      const tabId = 'test-tab-123';
      const errorMessage = 'SQL syntax error';
      const errorDetails = 'Line 1: Unexpected token';
      const query = 'SELECT * FROM invalid_table';
      const title = 'Failed Query';

      resultsViewProvider.showErrorForTab(tabId, errorMessage, errorDetails, query, title);

      assert.ok(postMessageStub.calledOnce);
      const message = postMessageStub.firstCall.args[0];
      assert.strictEqual(message.type, 'queryError');
      assert.strictEqual(message.tabId, tabId);
      assert.strictEqual(message.query, query);
      assert.strictEqual(message.title, title);
      assert.strictEqual(message.error.message, errorMessage);
      assert.strictEqual(message.error.details, errorDetails);
    });
  });

  describe('Webview Interaction', () => {
    test('should handle tab creation without webview gracefully', () => {
      const providerWithoutWebview = new ResultsViewProvider(mockContext.extensionUri);

      // Should not throw
      assert.doesNotThrow(() => {
        providerWithoutWebview.createTabWithId('test', 'SELECT 1', 'Test');
        providerWithoutWebview.closeActiveTab();
        providerWithoutWebview.closeOtherTabs();
        providerWithoutWebview.closeAllTabs();
      });
    });

    test('getOrCreateActiveTabId should return valid tab ID even without webview', () => {
      const providerWithoutWebview = new ResultsViewProvider(mockContext.extensionUri);

      const tabId = providerWithoutWebview.getOrCreateActiveTabId('SELECT 1', 'Test');

      assert.ok(typeof tabId === 'string');
      assert.ok(tabId.length > 0);
      assert.ok(tabId.startsWith('tab-'));
    });
  });
});
