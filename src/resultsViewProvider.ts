import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Manages the webview panel for displaying query results.
 * It handles:
 * - Creating and initializing the webview HTML.
 * - Receiving messages from the extension (e.g., query results, errors).
 * - Sending messages from the webview back to the extension (if needed later).
 */
export class ResultsViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'sqlResultsView';

  private _view?: vscode.WebviewView;
  private _outputChannel: vscode.OutputChannel;

  constructor(private readonly _extensionUri: vscode.Uri) {
    this._outputChannel = vscode.window.createOutputChannel('SQL Preview');
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
        // Add more cases to handle messages from webview JS
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
  public createTabWithId(tabId: string, query: string, title?: string) {
    if (this._view) {
      this._view.show?.(true);

      // Focus the SQL Preview panel when creating a new tab
      this._focusPanel();

      this._view.webview.postMessage({
        type: 'createTab',
        tabId: tabId,
        query: query,
        title: title || `Query ${Date.now()}`,
      });
    }
  }

  /** Gets the active tab ID or creates a new tab if none exists */
  public getOrCreateActiveTabId(query: string, title?: string): string {
    if (this._view) {
      this._view.show?.(true);
      this._focusPanel();

      // Send message to webview to reuse active tab or create new one
      this._view.webview.postMessage({
        type: 'reuseOrCreateActiveTab',
        query: query,
        title: title || `Query ${Date.now()}`,
      });
      // Return a placeholder ID - the actual tab ID will be determined by the webview
      return 'active-tab-placeholder';
    }
    // Fallback ID if webview is not available
    return `tab-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /** Closes the currently active tab */
  public closeActiveTab() {
    if (this._view) {
      this._view.webview.postMessage({
        type: 'closeActiveTab',
      });
    }
  }

  /** Closes all tabs except the active one */
  public closeOtherTabs() {
    if (this._view) {
      this._view.webview.postMessage({
        type: 'closeOtherTabs',
      });
    }
  }

  /** Closes all tabs */
  public closeAllTabs() {
    if (this._view) {
      this._view.webview.postMessage({
        type: 'closeAllTabs',
      });
    }
  }

  /** Shows loading state for a specific tab */
  public showLoadingForTab(tabId: string, query?: string, title?: string) {
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
    if (this._view) {
      this._view.show?.(true);
      // Focus the panel when showing results
      this._focusPanel();

      this._view.webview.postMessage({
        type: 'resultData',
        tabId: tabId,
        data: data,
      });
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
    }
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
