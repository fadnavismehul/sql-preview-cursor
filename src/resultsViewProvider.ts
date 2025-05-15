import * as vscode from 'vscode';

/**
 * Manages the webview panel for displaying query results.
 * It handles:
 * - Creating and initializing the webview HTML.
 * - Receiving messages from the extension (e.g., query results, errors).
 * - Sending messages from the webview back to the extension (if needed later).
 */
export class ResultsViewProvider implements vscode.WebviewViewProvider {

    public static readonly viewType = 'prestoResultsView';

    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
    ) { }

    /**
     * Called when the view is resolved (i.e., created or shown).
     * Sets up the webview's initial HTML content and message handling.
     */
    resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            // Allow scripts in the webview
            enableScripts: true,
            // Restrict the webview to only loading resources from our extension's directories
            localResourceRoots: [
                 vscode.Uri.joinPath(this._extensionUri, 'media'),
                 vscode.Uri.joinPath(this._extensionUri, 'webviews')
            ]
        };

        // Set the initial HTML content
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from the webview (if needed in the future)
        webviewView.webview.onDidReceiveMessage(data => {
            switch (data.command) {
                case 'alert':
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
        columns: any[], 
        rows: any[][], 
        query: string,
        wasTruncated: boolean,
        totalRowsInFirstBatch: number,
        queryId?: string,
        infoUri?: string,
        nextUri?: string
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
            this._view.webview.postMessage({ type: 'queryError', error: { message: errorMessage, details: errorDetails } });
        }
    }
    
    /** Sends a generic status message to the webview */
    public showStatusMessage(message: string) {
        if (this._view) {
            this._view.show?.(true);
            this._view.webview.postMessage({ type: 'statusMessage', message: message });
        }
    }

    // --- Private method to generate HTML --- 

    /**
     * Generates the complete HTML content for the webview.
     */
    private _getHtmlForWebview(webview: vscode.Webview): string {
        // Get URIs for local resources
        // IMPORTANT: Use webview.asWebviewUri to ensure resources load correctly

        // Nonce for Content Security Policy
        const nonce = getNonce();

        // URI for the main JS file for the webview
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'webviews', 'results', 'resultsView.js'));

        // URI for the main CSS file for the webview
        const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'webviews', 'results', 'resultsView.css'));
        
        // AG Grid CDN URIs (Community and Quartz theme)
        // Ensure these are major versions or have SRI if possible for security.
        const agGridScriptUri = "https://unpkg.com/ag-grid-community@31.3.2/dist/ag-grid-community.min.js";
        const agGridStylesUri = "https://unpkg.com/ag-grid-community@31.3.2/styles/ag-grid.css";
        const agGridThemeStylesUri = "https://unpkg.com/ag-grid-community@31.3.2/styles/ag-theme-quartz.css";

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
                
                <title>Presto Results</title>
            </head>
            <body>
                <div class="controls">
                    <div>
                        <span id="status-message">Ready</span>
                        <span id="row-count-info"></span>
                        <span id="truncation-warning" style="display: none; color: var(--vscode-descriptionForeground); margin-left: 10px;">(Results limited)</span>
                    </div>
                    <div>
                        <!-- Placeholder for Export Button -->
                        <button id="export-button" style="display: none;" title="Export full results to CSV">Export CSV</button> 
                    </div>
                </div>

                <div id="error-container" class="error-message" style="display: none;"></div>

                <div id="loading-indicator" class="loading" style="display: none;">
                     <div class="spinner"></div> 
                     <span>Loading...</span>
                </div>

                <!-- AG Grid Container: Ensure it has a theme class -->
                <div id="results-grid" class="ag-theme-quartz"></div>

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