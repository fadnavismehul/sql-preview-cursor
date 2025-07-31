import * as vscode from 'vscode';

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

  constructor(private readonly _extensionUri: vscode.Uri) {}

  /**
   * Called when the view is resolved (i.e., created or shown).
   * Sets up the webview's initial HTML content and message handling.
   */
  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;

    webviewView.webview.options = {
      // Allow scripts in the webview
      enableScripts: true,
      // Restrict the webview to only loading resources from our extension's directories
      localResourceRoots: [
        vscode.Uri.joinPath(this._extensionUri, 'media'),
        vscode.Uri.joinPath(this._extensionUri, 'webviews'),
      ],
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
      this._view.webview.postMessage({
        type: 'createTab',
        tabId: tabId,
        query: query,
        title: title || `Query ${Date.now()}`,
      });
    }
  }

  /** Shows loading state for a specific tab */
  public showLoadingForTab(tabId: string, query?: string, title?: string) {
    if (this._view) {
      this._view.show?.(true);
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
      this._view.webview.postMessage({
        type: 'queryError',
        tabId: tabId,
        query: query,
        title: title,
        error: { message: errorMessage, details: errorDetails },
      });
    }
  }

  // --- Private method to generate HTML ---

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

    // URI for the main JS file for the webview
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'webviews', 'results', 'resultsView.js')
    );

    // URI for the main CSS file for the webview
    const stylesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'webviews', 'results', 'resultsView.css')
    );

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
                <link href="${stylesUri}" rel="stylesheet">
                
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
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
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
