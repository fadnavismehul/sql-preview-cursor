import * as vscode from 'vscode';
import * as path from 'path';

export interface TabData {
  id: string;
  title: string;
  query: string;
  columns: Array<{ name: string; type: string }>;
  rows: unknown[][];
  status: string;
  wasTruncated?: boolean | undefined;
  totalRowsInFirstBatch?: number | undefined;
  queryId?: string | undefined;
  infoUri?: string | undefined;
  nextUri?: string | undefined;
  error?: string | undefined;
  errorDetails?: string | undefined;
  sourceFileUri?: string | undefined;
}

/**
 * Manages the webview panel for displaying query results.
 * It handles:
 * - Creating and initializing the webview HTML.
 * - Receiving messages from the extension (e.g., query results, errors).
 * - Sending messages from the webview back to the extension (if needed later).
 */
export class ResultsViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'sqlResultsView';

  private _view?: vscode.WebviewView | undefined;
  private _outputChannel: vscode.OutputChannel;
  // Store tab data in memory for MCP access
  private _tabData: Map<string, TabData> = new Map();
  private _activeTabId: string | undefined;
  private _resultCounter = 1;
  private _storageUri: vscode.Uri | undefined;
  private _activeEditorUri: string | undefined;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    _context: vscode.ExtensionContext
  ) {
    this._outputChannel = vscode.window.createOutputChannel('SQL Preview');
    this._storageUri = _context.globalStorageUri;

    // Ensure storage directory exists
    vscode.workspace.fs.createDirectory(this._storageUri).then(
      () => this._loadState(),
      err => this.log(`Error creating storage directory: ${err}`)
    );

    // Listen for active editor changes
    // Listen for active editor changes
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor && editor.document && editor.document.languageId === 'sql') {
        this._activeEditorUri = editor.document.uri.toString();
        this._filterTabsByFile(this._activeEditorUri);
      }
      // If not a SQL file (or no editor), do nothing to preserve the last SQL view
    });
  }

  /**
   * Logs a message to the output channel.
   */
  public log(message: string) {
    this._outputChannel.appendLine(message);
  }

  /**
   * Called when the view is resolved (i.e., created or shown).
   * Sets up the webview's initial HTML content and message handling.
   */
  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;

    // Validate extension URI before proceeding
    if (
      !this._extensionUri ||
      !this._extensionUri.fsPath ||
      this._extensionUri.fsPath.trim() === ''
    ) {
      this._outputChannel.appendLine(
        'ERROR: Extension URI is invalid, webview may not load properly'
      );
      vscode.window.showErrorMessage(
        'SQL Preview: Extension initialization failed - invalid extension path'
      );
      return;
    }

    // Normalize the extension path to handle Windows path issues
    const normalizedExtensionPath = path.normalize(this._extensionUri.fsPath);
    if (!normalizedExtensionPath || normalizedExtensionPath.trim() === '') {
      this._outputChannel.appendLine('ERROR: Normalized extension path is empty');
      vscode.window.showErrorMessage('SQL Preview: Extension path normalization failed');
      return;
    }

    // Build resource roots with enhanced validation for Windows compatibility
    const resourceRoots: vscode.Uri[] = [];

    try {
      // Create media and webviews URIs with enhanced validation
      let mediaUri: vscode.Uri | undefined;
      let webviewsUri: vscode.Uri | undefined;

      // Attempt to create media URI with validation
      try {
        const mediaPath = 'media';
        if (mediaPath && mediaPath.trim() !== '') {
          mediaUri = vscode.Uri.joinPath(this._extensionUri, mediaPath);
          // Validate the resulting URI has a valid path
          if (!mediaUri || !mediaUri.fsPath || mediaUri.fsPath.trim() === '') {
            this._outputChannel.appendLine('WARNING: Media URI creation resulted in empty path');
            mediaUri = undefined;
          } else {
            const normalizedMediaPath = path.normalize(mediaUri.fsPath);
            if (!normalizedMediaPath || normalizedMediaPath.trim() === '') {
              this._outputChannel.appendLine(
                'WARNING: Media URI path normalization resulted in empty path'
              );
              mediaUri = undefined;
            }
          }
        }
      } catch (error) {
        this._outputChannel.appendLine(`WARNING: Failed to create media URI: ${error}`);
        mediaUri = undefined;
      }

      // Attempt to create webviews URI with validation
      try {
        const webviewsPath = 'webviews';
        if (webviewsPath && webviewsPath.trim() !== '') {
          webviewsUri = vscode.Uri.joinPath(this._extensionUri, webviewsPath);
          // Validate the resulting URI has a valid path
          if (!webviewsUri || !webviewsUri.fsPath || webviewsUri.fsPath.trim() === '') {
            this._outputChannel.appendLine('WARNING: Webviews URI creation resulted in empty path');
            webviewsUri = undefined;
          } else {
            const normalizedWebviewsPath = path.normalize(webviewsUri.fsPath);
            if (!normalizedWebviewsPath || normalizedWebviewsPath.trim() === '') {
              this._outputChannel.appendLine(
                'WARNING: Webviews URI path normalization resulted in empty path'
              );
              webviewsUri = undefined;
            }
          }
        }
      } catch (error) {
        this._outputChannel.appendLine(`WARNING: Failed to create webviews URI: ${error}`);
        webviewsUri = undefined;
      }

      // Only add URIs that passed all validation checks
      if (mediaUri) {
        resourceRoots.push(mediaUri);
        this._outputChannel.appendLine(`Added media resource root: ${mediaUri.fsPath}`);
      }
      if (webviewsUri) {
        resourceRoots.push(webviewsUri);
        this._outputChannel.appendLine(`Added webviews resource root: ${webviewsUri.fsPath}`);
      }

      // Provide fallback behavior if no resource roots were created
      if (resourceRoots.length === 0) {
        this._outputChannel.appendLine(
          'WARNING: No valid resource roots created, attempting to use extension URI directly'
        );
        // As a fallback, use the extension URI itself as a resource root
        if (
          this._extensionUri &&
          this._extensionUri.fsPath &&
          this._extensionUri.fsPath.trim() !== ''
        ) {
          resourceRoots.push(this._extensionUri);
          this._outputChannel.appendLine(
            `Using extension URI as fallback resource root: ${this._extensionUri.fsPath}`
          );
        } else {
          this._outputChannel.appendLine(
            'ERROR: Extension URI is also invalid, webview resources will not load properly'
          );
        }
      }
    } catch (error) {
      this._outputChannel.appendLine(`ERROR: Error creating resource URIs: ${error}`);
      // Don't return here - continue with empty resource roots rather than failing completely
      this._outputChannel.appendLine(
        'Continuing with empty resource roots, some webview resources may not load'
      );
    }

    webviewView.webview.options = {
      // Allow scripts in the webview
      enableScripts: true,
      // Restrict the webview to only loading resources from our extension's directories
      localResourceRoots: resourceRoots,
    };

    // Set the initial HTML content
    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Listen for configuration changes and update the webview
    const configListener = vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('sqlPreview.fontSize')) {
        // Get the new font size setting
        const config = vscode.workspace.getConfiguration('sqlPreview');
        const customFontSize = config.get<number>('fontSize', 0);

        // Send message to webview to update font size without losing state
        const fontSizeValue =
          customFontSize > 0
            ? `${customFontSize}px`
            : `var(--vscode-editor-font-size, var(--vscode-font-size))`;

        webviewView.webview.postMessage({
          type: 'updateFontSize',
          fontSize: fontSizeValue,
        });
      }
    });

    // Dispose of the listener when the webview is disposed
    webviewView.onDidDispose(() => {
      configListener.dispose();
      this._view = undefined; // Clear the view reference so we know to re-initialize/focus correctly
    });

    // Handle messages from the webview (if needed in the future)
    webviewView.webview.onDidReceiveMessage(data => {
      switch (data.command) {
        case 'alert':
          vscode.window.showErrorMessage(data.text);
          return;
        case 'createNewTab':
          this.createTab('New Query');
          return;
        case 'showInfo':
          vscode.window.showInformationMessage(data.text);
          return;
        case 'showError':
          vscode.window.showErrorMessage(data.text);
          return;
        case 'exportFullResults':
          this.handleFullResultsExport(data);
          return;
        case 'webviewLoaded':
          // Webview is ready, send persisted tabs
          this._restoreTabsToWebview();
          // Apply current filter
          if (this._activeEditorUri) {
            this._filterTabsByFile(this._activeEditorUri);
          }
          return;
        case 'tabClosed':
          // Handle tab closure
          this.log(`Tab closed: ${data.tabId}`);
          this._tabData.delete(data.tabId);
          if (this._activeTabId === data.tabId) {
            this._activeTabId = undefined;
          }
          this._saveState();
          return;
        case 'updateTabState': {
          // Handle tab state updates (e.g. title change)
          const tab = this._tabData.get(data.tabId);
          if (tab) {
            if (data.title) {
              tab.title = data.title;
            }
            if (data.query) {
              tab.query = data.query;
            }
            this._saveState();
          }
          return;
        }
      }
    });
  }

  // --- Public methods to interact with the webview from the extension ---

  /** Sends loading state message to the webview */
  public showLoading() {
    if (this._view) {
      this._view.show?.(true); // Ensure the view is visible
      this._view.webview.postMessage({ type: 'showLoading' });
    }
  }

  /** Sends query results to the webview */
  public showResults(data: {
    columns: Array<{ name: string; type: string }>;
    rows: unknown[][];
    query: string;
    wasTruncated: boolean;
    totalRowsInFirstBatch: number;
    queryId?: string;
    infoUri?: string;
    nextUri?: string;
  }) {
    if (this._view) {
      this._view.show?.(true);
      this._view.webview.postMessage({ type: 'resultData', data: data });
    }
  }

  /** Sends error messages to the webview */
  public showError(errorMessage: string, errorDetails?: string) {
    if (this._view) {
      this._view.show?.(true);
      this._view.webview.postMessage({
        type: 'queryError',
        error: { message: errorMessage, details: errorDetails },
      });
    }
  }

  /** Sends a generic status message to the webview */
  public showStatusMessage(message: string) {
    if (this._view) {
      this._view.show?.(true);
      this._view.webview.postMessage({ type: 'statusMessage', message: message });
    }
  }

  /** Creates a new tab in the webview */
  public createTab(query: string, title?: string) {
    if (this._view) {
      this._view.show?.(true);
      this._view.webview.postMessage({
        type: 'createTab',
        query: query,
        title: title || `Query ${Date.now()}`,
      });
    }
  }

  /** Creates a new tab with a specific ID in the webview */
  public createTabWithId(tabId: string, query: string, title?: string, sourceFileUri?: string) {
    this.log(`createTabWithId called: ${tabId}`);

    // Generate title if not provided
    const finalTitle = title || `Result ${this._resultCounter++}`;

    // Initialize data for this tab immediately (persist state)
    this._tabData.set(tabId, {
      id: tabId,
      title: finalTitle,
      query: query,
      columns: [],
      rows: [],
      status: 'created',
      sourceFileUri: sourceFileUri,
    });

    // Track active tab
    this._activeTabId = tabId;
    this._saveState(); // Save state after creation
    this.log(`Tab data initialized for: ${tabId}`);

    if (this._view) {
      this._view.show?.(true);
      this._focusPanel();

      this._view.webview.postMessage({
        type: 'createTab',
        tabId: tabId,
        query: query,
        title: finalTitle,
        sourceFileUri: sourceFileUri,
      });
    } else {
      this.log('createTabWithId: _view is undefined, attempting to focus panel to restore state');
      this._focusPanel();
    }
  }

  /** Gets the active tab ID or creates a new tab if none exists */
  public getOrCreateActiveTabId(query: string, title?: string, sourceFileUri?: string): string {
    // If we have an active tab, reuse it
    if (this._activeTabId && this._tabData.has(this._activeTabId)) {
      const tabId = this._activeTabId;
      this.log(`getOrCreateActiveTabId: Reusing active tab ${tabId}`);

      // Update existing tab data
      const existing = this._tabData.get(tabId);
      if (existing) {
        existing.query = query;
        if (title) {
          existing.title = title;
        }
        if (sourceFileUri) {
          existing.sourceFileUri = sourceFileUri;
        }
        this._saveState();

        if (this._view) {
          this._view.show?.(true);
          this._focusPanel();

          // Send message to webview to reuse active tab
          this._view.webview.postMessage({
            type: 'reuseOrCreateActiveTab',
            query: query,
            title: title || existing.title,
            sourceFileUri: sourceFileUri,
          });
        } else {
          this._focusPanel();
        }
      }
      return tabId;
    }

    // No active tab, create new one
    const newTabId = `tab-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    this.log(`getOrCreateActiveTabId: No active tab, creating new ${newTabId}`);
    this.createTabWithId(newTabId, query, title, sourceFileUri);
    return newTabId;
  }

  /** Closes the currently active tab */
  public closeActiveTab() {
    this.log('closeActiveTab called');
    if (this._view) {
      this._view.webview.postMessage({
        type: 'closeActiveTab',
      });
    }
  }

  /** Closes all tabs except the active one */
  public closeOtherTabs() {
    this.log('closeOtherTabs called');
    if (this._view) {
      this._view.webview.postMessage({
        type: 'closeOtherTabs',
      });
    }
  }

  /** Closes all tabs */
  public closeAllTabs() {
    this.log('closeAllTabs called');
    if (this._view) {
      this._view.webview.postMessage({
        type: 'closeAllTabs',
      });
    }
    // Clear backend state as well
    this._tabData.clear();
    this._activeTabId = undefined;
    this._saveState();
  }

  /** Shows loading state for a specific tab */
  public showLoadingForTab(tabId: string, query?: string, title?: string) {
    this.log(`showLoadingForTab called for: ${tabId}`);

    // Update stored data to reflect loading state
    const existingData = this._tabData.get(tabId);
    if (existingData) {
      existingData.status = 'loading';
      if (query) {
        existingData.query = query;
      }
      if (title) {
        existingData.title = title;
      }
      this._saveState();
    }

    if (this._view) {
      // Ensure the SQL Preview panel is visible and focused
      this._view.show?.(true);
      this._focusPanel();

      this._view.webview.postMessage({
        type: 'showLoading',
        tabId: tabId,
        query: query,
        title: title,
      });
    }
  }

  /** Shows results for a specific tab */
  public showResultsForTab(
    tabId: string,
    data: {
      columns: Array<{ name: string; type: string }>;
      rows: unknown[][];
      query: string;
      wasTruncated: boolean;
      totalRowsInFirstBatch: number;
      queryId?: string;
      infoUri?: string;
      nextUri?: string;
    }
  ) {
    this.log(`showResultsForTab called for: ${tabId}`);

    // Update stored data unconditionally
    const existingData = this._tabData.get(tabId);
    const newData: TabData = {
      id: tabId,
      title: existingData?.title || 'Query Results',
      query: data.query,
      columns: data.columns,
      rows: data.rows,
      status: 'success',
      wasTruncated: data.wasTruncated,
      totalRowsInFirstBatch: data.totalRowsInFirstBatch,
      queryId: data.queryId,
      infoUri: data.infoUri,
      nextUri: data.nextUri,
      // Preserve existing error info if any (though success usually clears it)
      error: undefined,
      errorDetails: undefined,
      sourceFileUri: existingData?.sourceFileUri, // Preserve source file URI
    };
    this._tabData.set(tabId, newData);
    this.log(`Tab data updated for: ${tabId}. Rows: ${data.rows.length}`);

    // Update active tab if this is the one being shown
    this._activeTabId = tabId;
    this._saveState(); // Save state after update

    if (this._view) {
      this._view.show?.(true);
      // Focus the panel when showing results
      this._focusPanel();

      this._view.webview.postMessage({
        type: 'resultData',
        tabId: tabId,
        data: data,
        title: newData.title, // Pass title to ensure webview updates it if needed
      });
    } else {
      this.log('showResultsForTab: _view is undefined, attempting to focus panel');
      this._focusPanel();
    }
  }

  /** Shows error for a specific tab */
  public showErrorForTab(
    tabId: string,
    errorMessage: string,
    errorDetails?: string,
    query?: string,
    title?: string
  ) {
    this.log(`showErrorForTab called for: ${tabId}. Error: ${errorMessage}`);
    // Update stored data with error unconditionally
    const existingData = this._tabData.get(tabId);
    const newData: TabData = {
      id: tabId,
      title: title || existingData?.title || 'Error',
      query: query || existingData?.query || '',
      columns: existingData?.columns || [],
      rows: existingData?.rows || [],
      status: 'error',
      error: errorMessage,
      errorDetails: errorDetails,
      // Preserve other fields
      wasTruncated: existingData?.wasTruncated,
      totalRowsInFirstBatch: existingData?.totalRowsInFirstBatch,
      queryId: existingData?.queryId,
      infoUri: existingData?.infoUri,
      nextUri: existingData?.nextUri,
      sourceFileUri: existingData?.sourceFileUri,
    };
    this._tabData.set(tabId, newData);
    this._saveState(); // Save state after error
    this.log(`Tab data updated with error for: ${tabId}`);

    if (this._view) {
      this._view.show?.(true);
      // Focus the panel when showing errors so user can see what went wrong
      this._focusPanel();

      this._view.webview.postMessage({
        type: 'queryError',
        tabId: tabId,
        query: query,
        title: title,
        error: { message: errorMessage, details: errorDetails },
      });
    } else {
      this._focusPanel();
    }
  }

  // --- Public methods for MCP Server ---

  /**
   * Returns a list of all active tabs with basic metadata
   */
  public getTabs(): Array<{ id: string; title: string; query: string; status: string }> {
    this.log(`getTabs called. Count: ${this._tabData.size}`);
    const tabs: Array<{ id: string; title: string; query: string; status: string }> = [];
    this._tabData.forEach((data, id) => {
      tabs.push({
        id: id,
        title: data.title || `Tab ${id}`,
        query: data.query || '',
        status: data.status || 'unknown',
      });
    });
    return tabs;
  }

  /**
   * Returns the full data for a specific tab
   */
  public getTabData(tabId: string): TabData | undefined {
    this.log(`getTabData called for: ${tabId}`);
    return this._tabData.get(tabId);
  }

  /**
   * Returns the ID of the currently active tab
   */
  public getActiveTabId(): string | undefined {
    this.log(`getActiveTabId called. Current: ${this._activeTabId}`);
    return this._activeTabId;
  }

  /**
   * Returns the maximum result counter for a given file URI based on existing tabs.
   */
  public getMaxResultCountForFile(fileUri: string | undefined): number {
    if (!fileUri) {
      return 0;
    }
    let maxCount = 0;
    this._tabData.forEach(tab => {
      if (tab.sourceFileUri === fileUri) {
        // Parse title "Result X"
        const match = tab.title.match(/^Result (\d+)$/);
        if (match && match[1]) {
          const count = parseInt(match[1], 10);
          if (!isNaN(count) && count > maxCount) {
            maxCount = count;
          }
        }
      }
    });
    return maxCount;
  }

  // --- Private methods ---

  /**
   * Attempts to focus the SQL Preview panel using various VS Code commands
   */
  private _focusPanel(): void {
    // Try multiple approaches to focus the panel, as different VS Code versions
    // and configurations may respond to different commands
    Promise.resolve(vscode.commands.executeCommand('sqlResultsView.focus')).catch(() => {
      // If the specific view focus doesn't work, try focusing the container
      Promise.resolve(
        vscode.commands.executeCommand('workbench.view.extension.sqlResultsContainer')
      ).catch(() => {
        // As a last resort, try to focus the panel area
        Promise.resolve(vscode.commands.executeCommand('workbench.action.focusPanel')).catch(() => {
          // All focus attempts failed, but show(true) should still make it visible
        });
      });
    });
  }

  // --- Persistence Methods ---

  private async _saveState() {
    if (!this._storageUri) {
      return;
    }
    try {
      const stateFile = vscode.Uri.joinPath(this._storageUri, 'tabState.json');
      const dataToSave = {
        tabs: Array.from(this._tabData.entries()),
        resultCounter: this._resultCounter,
      };
      await vscode.workspace.fs.writeFile(stateFile, Buffer.from(JSON.stringify(dataToSave)));
    } catch (err) {
      this.log(`Error saving state: ${err}`);
    }
  }

  private async _loadState() {
    if (!this._storageUri) {
      return;
    }
    try {
      const stateFile = vscode.Uri.joinPath(this._storageUri, 'tabState.json');
      const content = await vscode.workspace.fs.readFile(stateFile);
      const savedData = JSON.parse(content.toString());

      if (savedData.tabs) {
        this._tabData = new Map(savedData.tabs);
      }
      if (savedData.resultCounter) {
        this._resultCounter = savedData.resultCounter;
      }
      this.log(`State loaded. Tabs: ${this._tabData.size}`);
    } catch (err) {
      // Ignore error if file doesn't exist (first run)
      this.log(`No saved state found or error loading: ${err}`);
    }
  }

  private _restoreTabsToWebview() {
    if (!this._view) {
      return;
    }

    this._tabData.forEach(tab => {
      this._view?.webview.postMessage({
        type: 'createTab',
        tabId: tab.id,
        query: tab.query,
        title: tab.title,
        sourceFileUri: tab.sourceFileUri,
      });

      if (tab.status === 'success' && tab.rows.length > 0) {
        this._view?.webview.postMessage({
          type: 'resultData',
          tabId: tab.id,
          data: {
            columns: tab.columns,
            rows: tab.rows,
            query: tab.query,
            wasTruncated: tab.wasTruncated || false,
            totalRowsInFirstBatch: tab.totalRowsInFirstBatch || tab.rows.length,
            queryId: tab.queryId,
            infoUri: tab.infoUri,
            nextUri: tab.nextUri,
          },
        });
      } else if (tab.status === 'error') {
        this._view?.webview.postMessage({
          type: 'queryError',
          tabId: tab.id,
          query: tab.query,
          title: tab.title,
          error: { message: tab.error || 'Unknown error', details: tab.errorDetails },
        });
      } else if (tab.status === 'loading') {
        this._view?.webview.postMessage({
          type: 'showLoading',
          tabId: tab.id,
          query: tab.query,
          title: tab.title,
        });
      }
    });
  }

  private _filterTabsByFile(fileUri: string | undefined) {
    if (this._view) {
      this._view.webview.postMessage({
        type: 'filterTabs',
        fileUri: fileUri,
      });
    }
  }

  /**
   * Generates the complete HTML content for the webview.
   */
  private _getHtmlForWebview(webview: vscode.Webview): string {
    // Get URIs for local resources
    // IMPORTANT: Use webview.asWebviewUri to ensure resources load correctly

    // Get font size configuration
    const config = vscode.workspace.getConfiguration('sqlPreview');
    const customFontSize = config.get<number>('fontSize', 0);

    // Nonce for Content Security Policy
    const nonce = getNonce();

    // Validate extension URI and create resource URIs with enhanced error handling for Windows
    let scriptUri: vscode.Uri | undefined;
    let stylesUri: vscode.Uri | undefined;

    try {
      if (
        !this._extensionUri ||
        !this._extensionUri.fsPath ||
        this._extensionUri.fsPath.trim() === ''
      ) {
        throw new Error('Extension URI is invalid or empty');
      }

      // Normalize the extension path to handle Windows path issues
      const normalizedExtensionPath = path.normalize(this._extensionUri.fsPath);
      if (!normalizedExtensionPath || normalizedExtensionPath.trim() === '') {
        throw new Error('Normalized extension path is empty');
      }

      // Create script URI with enhanced validation
      try {
        const scriptPath = vscode.Uri.joinPath(
          this._extensionUri,
          'webviews',
          'results',
          'resultsView.js'
        );

        if (scriptPath && scriptPath.fsPath && scriptPath.fsPath.trim() !== '') {
          const normalizedScriptPath = path.normalize(scriptPath.fsPath);
          if (normalizedScriptPath && normalizedScriptPath.trim() !== '') {
            try {
              scriptUri = webview.asWebviewUri(scriptPath);
              // Validate the resulting webview URI
              if (!scriptUri || !scriptUri.toString() || scriptUri.toString().trim() === '') {
                this._outputChannel.appendLine(
                  'WARNING: Script webview URI creation resulted in empty URI'
                );
                scriptUri = undefined;
              }
            } catch (webviewError) {
              this._outputChannel.appendLine(
                `WARNING: Failed to create script webview URI: ${webviewError}`
              );
              scriptUri = undefined;
            }
          } else {
            this._outputChannel.appendLine(
              'WARNING: Script path normalization resulted in empty path'
            );
          }
        } else {
          this._outputChannel.appendLine('WARNING: Script path creation resulted in invalid path');
        }
      } catch (scriptError) {
        this._outputChannel.appendLine(`WARNING: Failed to create script path: ${scriptError}`);
        scriptUri = undefined;
      }

      // Create styles URI with enhanced validation
      try {
        const stylesPath = vscode.Uri.joinPath(
          this._extensionUri,
          'webviews',
          'results',
          'resultsView.css'
        );

        if (stylesPath && stylesPath.fsPath && stylesPath.fsPath.trim() !== '') {
          const normalizedStylesPath = path.normalize(stylesPath.fsPath);
          if (normalizedStylesPath && normalizedStylesPath.trim() !== '') {
            try {
              stylesUri = webview.asWebviewUri(stylesPath);
              // Validate the resulting webview URI
              if (!stylesUri || !stylesUri.toString() || stylesUri.toString().trim() === '') {
                this._outputChannel.appendLine(
                  'WARNING: Styles webview URI creation resulted in empty URI'
                );
                stylesUri = undefined;
              }
            } catch (webviewError) {
              this._outputChannel.appendLine(
                `WARNING: Failed to create styles webview URI: ${webviewError}`
              );
              stylesUri = undefined;
            }
          } else {
            this._outputChannel.appendLine(
              'WARNING: Styles path normalization resulted in empty path'
            );
          }
        } else {
          this._outputChannel.appendLine('WARNING: Styles path creation resulted in invalid path');
        }
      } catch (stylesError) {
        this._outputChannel.appendLine(`WARNING: Failed to create styles path: ${stylesError}`);
        stylesUri = undefined;
      }
    } catch (error) {
      this._outputChannel.appendLine(`ERROR: Error creating webview resource URIs: ${error}`);
      // Fall back to inline styles/scripts if resource URIs fail
    }

    // AG Grid CDN URIs (Community and Quartz theme)
    // Ensure these are major versions or have SRI if possible for security.
    const agGridScriptUri =
      'https://unpkg.com/ag-grid-community@31.3.2/dist/ag-grid-community.min.js';
    const agGridStylesUri = 'https://unpkg.com/ag-grid-community@31.3.2/styles/ag-grid.css';
    const agGridThemeStylesUri =
      'https://unpkg.com/ag-grid-community@31.3.2/styles/ag-theme-quartz.css';

    // Content Security Policy
    // Allow scripts with nonce, scripts from unpkg.com (for AG Grid), and inline styles (for themes/grid itself).
    // Added unpkg.com to style-src, font-src, and img-src for AG Grid assets.
    const cspSource = webview.cspSource; // vscode-resource:
    const csp = `
            default-src 'none'; 
            script-src 'nonce-${nonce}' https://unpkg.com;
            style-src ${cspSource} 'unsafe-inline' https://unpkg.com;
            font-src ${cspSource} https://unpkg.com https: data:;
            img-src ${cspSource} https://unpkg.com https: data:;
            connect-src https://*.myteksi.net https://sentry.io ${cspSource};
        `;

    // Generate font size CSS custom property
    const fontSizeStyle =
      customFontSize > 0
        ? `--sql-preview-font-size: ${customFontSize}px;`
        : `--sql-preview-font-size: var(--vscode-editor-font-size, var(--vscode-font-size));`;

    return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">

                <!-- Content Security Policy -->
                <meta http-equiv="Content-Security-Policy" content="${csp}">
                
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                
                <!-- Load AG Grid CSS -->
                <link href="${agGridStylesUri}" rel="stylesheet">
                <link href="${agGridThemeStylesUri}" rel="stylesheet">
                <!-- Load local CSS -->
                ${stylesUri ? `<link href="${stylesUri}" rel="stylesheet">` : '<!-- Local CSS not available -->'}
                
                <!-- Custom font size configuration -->
                <style nonce="${nonce}">
                    :root {
                        ${fontSizeStyle}
                    }
                </style>
                
                <title>SQL Preview Results</title>
            </head>
            <body>
                <!-- Tab Container -->
                <div id="tab-container" class="tab-container">
                    <div id="tab-list" class="tab-list">
                        <!-- Tabs will be dynamically added here -->
                    </div>
                    <button id="new-tab-button" class="new-tab-button" title="New Query Tab">+</button>
                </div>

                <!-- Tab Content Container -->
                <div id="tab-content-container" class="tab-content-container">
                    <!-- Default tab content when no tabs exist -->
                    <div id="no-tabs-message" class="no-tabs-message">
                        <p>Execute a SQL query to create your first results tab</p>
                    </div>
                    
                    <!-- Tab content will be dynamically added here -->
                </div>

                <!-- Load AG Grid JS -->
                <script nonce="${nonce}" src="${agGridScriptUri}"></script>
                <!-- Load local JS -->
                ${scriptUri ? `<script nonce="${nonce}" src="${scriptUri}"></script>` : '<!-- Local JS not available -->'}
            </body>
            </html>`;
  }

  /** Handles full results export request from webview */
  private async handleFullResultsExport(data: {
    tabId: string;
    query: string;
    wasTruncated: boolean;
  }) {
    try {
      if (!data.query) {
        vscode.window.showErrorMessage('No query available for export.');
        return;
      }

      if (!data.wasTruncated) {
        // If data wasn't truncated, we already have all the data
        vscode.window.showInformationMessage(
          'All query results are already displayed. Use "Export Displayed" instead.'
        );
        return;
      }

      // Show info that we're about to execute the full query
      const proceed = await vscode.window.showInformationMessage(
        'This will re-execute the query to fetch all results for export. This may take some time for large result sets. Continue?',
        'Yes',
        'Cancel'
      );

      if (proceed !== 'Yes') {
        return;
      }

      // Show a save dialog to let user choose where to save the CSV
      const saveUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file('query_results.csv'),
        filters: {
          'CSV Files': ['csv'],
          'All Files': ['*'],
        },
      });

      if (!saveUri) {
        return; // User cancelled
      }

      // Execute the full export by sending a command to the extension
      vscode.commands.executeCommand('sql.exportFullResults', {
        query: data.query,
        filePath: saveUri.fsPath,
        tabId: data.tabId,
      });
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to export full results: ${error}`);
    }
  }
}

/**
 * Generates a random nonce string for Content Security Policy.
 */
function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
