import * as vscode from 'vscode';
// Use NAMED import for Trino and BasicAuth
import { Trino, BasicAuth } from 'trino-client'; 
import { PrestoCodeLensProvider } from './PrestoCodeLensProvider'; // Corrected filename casing
import { ResultsViewProvider } from './resultsViewProvider';
import axios from 'axios'; // Import axios
import * as https from 'https'; // Import https for custom agent

let resultsViewProvider: ResultsViewProvider | undefined;

// --- Module-level state for last query results --- 
// Store the full first batch and pagination info for potential export
interface LastQueryResult {
    columns: { name: string; type: string }[];
    rows: any[][];
    query: string;
    nextUri?: string; // URI for the next page, if any
    infoUri?: string; // Info URI for the query
    id?: string;      // Query ID
}
let lastSuccessfulQueryResult: LastQueryResult | null = null;
// --- End state --- 

// Create a reusable HTTPS agent for axios requests (important for custom SSL verification)
const createHttpsAgent = (sslVerify: boolean) => {
    return new https.Agent({
        rejectUnauthorized: sslVerify
    });
};

/**
 * This method is called when your extension is activated.
 * Your extension is activated the very first time the command is executed
 * or when a file with the language ID 'sql' is opened.
 */
export function activate(context: vscode.ExtensionContext) {

    console.log('Congratulations, your extension "presto-runner" is now active!');

    // Register the Results Webview View Provider
    resultsViewProvider = new ResultsViewProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(ResultsViewProvider.viewType, resultsViewProvider)
    );

    // Register the CodeLens provider for SQL files
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider({ language: 'sql' }, new PrestoCodeLensProvider())
    );

    // Register the command to run the query under the cursor
    const runQueryCommand = vscode.commands.registerCommand('sql.runCursorQuery', async (sqlFromCodeLens: string) => {
        if (!resultsViewProvider) {
            vscode.window.showErrorMessage('Results view is not available.');
            return;
        }
        
        // --- Strip trailing semicolon and whitespace --- 
        const sql = sqlFromCodeLens.trim().replace(/;$/, '').trim();
        if (!sql) {
            vscode.window.showInformationMessage('No SQL query found to run.');
            return; 
        }
        // --- End stripping ---

        // Generate a unique tab ID for this query
        const tabId = `tab-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        const queryPreview = sql.length > 30 ? sql.substring(0, 30) + '...' : sql;
        
        // Create a new tab with the specific tabId and show loading
        resultsViewProvider.createTabWithId(tabId, sql, queryPreview);
        resultsViewProvider.showLoadingForTab(tabId, sql, queryPreview);

        const config = vscode.workspace.getConfiguration('sqlPreview');
        const host = config.get<string>('host', 'localhost');
        const port = config.get<number>('port', 8080);
        const user = config.get<string>('user', 'user');
        const catalog = config.get<string>('catalog') || undefined;
        const schema = config.get<string>('schema') || undefined;
        const password = config.get<string>('password') || undefined;
        const ssl = config.get<boolean>('ssl', false);
        const sslVerify = config.get<boolean>('sslVerify', true);
        const maxRows = config.get<number>('maxRowsToDisplay', 500);

        // --- Setup Authentication --- 
        let basicAuthHeader: string | undefined;
        if (password) {
            basicAuthHeader = 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
        }
        // TODO: Handle other auth methods if needed

        // --- Setup Client Options (excluding auth for create) --- 
        const clientOptions: any = {
            server: `${ssl ? 'https' : 'http'}://${host}:${port}`,
            user: user,
            catalog: catalog,
            schema: schema,
            ssl: ssl ? { rejectUnauthorized: sslVerify } : undefined,
            // Pass custom agent ONLY if using SSL and custom verification needed
            // httpsAgent: ssl ? createHttpsAgent(sslVerify) : undefined 
             // NOTE: trino-client might not support custom httpsAgent directly in options.
             // We will handle SSL verification in direct axios calls.
        };
        // Add auth separately if supported by create method in this version
        if (password) {
             clientOptions.auth = new BasicAuth(user, password);
        }

        const client = Trino.create(clientOptions);

        try {
            console.log(`Executing query: ${sql.substring(0, 100)}...`);

            const results: any[][] = [];
            let columns: { name: string; type: string }[] | null = null;
            let rawResultObject: any = null;
            let nextUriFromResponse: string | undefined = undefined;
            let infoUriFromResponse: string | undefined = undefined;
            let queryIdFromResponse: string | undefined = undefined;
            let wasTruncated = false;
            let totalRowsFetched = 0;
            let currentPageUri: string | undefined = undefined; // Declare higher scope

            // --- Execute Query and Fetch Pages --- 
            console.log("Attempting to fetch first page...");
            const queryIter = await client.query(sql);
            const firstIteration = await queryIter.next();
            rawResultObject = firstIteration.value;
            const firstDone = firstIteration.done;
            console.log(`First iteration result: done = ${firstDone}`);

            if (rawResultObject) {
                console.log("Raw FIRST queryResult value received."); // No need to log full object now
                if (rawResultObject.columns && Array.isArray(rawResultObject.columns)) {
                    columns = rawResultObject.columns.map((col: { name: string; type: string }) => ({ 
                        name: col.name, 
                        type: col.type 
                    }));
                }
                if (rawResultObject.data && Array.isArray(rawResultObject.data)) {
                    results.push(...rawResultObject.data);
                    totalRowsFetched += rawResultObject.data.length;
                }
                nextUriFromResponse = rawResultObject.nextUri;
                infoUriFromResponse = rawResultObject.infoUri;
                queryIdFromResponse = rawResultObject.id;
            }

            // --- Fetch subsequent pages if needed --- 
            currentPageUri = nextUriFromResponse; // Initialize before loop
            if (columns && columns.length > 0) { 
                let pageCount = 1;
                const httpsAgent = createHttpsAgent(sslVerify); 
                
                while (currentPageUri && totalRowsFetched < maxRows) {
                    pageCount++;
                    console.log(`Fetching page ${pageCount} (total rows so far: ${totalRowsFetched})... URI: ${currentPageUri}`);
                    
                    try {
                        // Cast the config to any to bypass type checking for Node.js specific options
                        const config: any = {
                            headers: basicAuthHeader ? { 'Authorization': basicAuthHeader } : undefined,
                        };
                        if (httpsAgent) {
                            config.httpsAgent = httpsAgent;
                        }
                        const response = await axios.get(currentPageUri, config);
                        
                        const pageData: any = response.data;
                        if (pageData?.data && Array.isArray(pageData.data)) {
                            results.push(...pageData.data);
                            totalRowsFetched += pageData.data.length;
                            console.log(`Fetched ${pageData.data.length} rows from page ${pageCount}. New total: ${totalRowsFetched}`);
                        }
                        currentPageUri = pageData?.nextUri;
                        if (!currentPageUri) {
                            console.log("No nextUri found in page", pageCount, "response. Pagination complete.");
                        }
                    } catch (pageError: any) {
                        console.error(`Error fetching page ${pageCount} from ${currentPageUri}:`, pageError.message);
                        vscode.window.showWarningMessage(`Failed to fetch all results page ${pageCount}: ${pageError.message}`);
                        currentPageUri = undefined; // Stop pagination on error
                    }
                }
                
                // Check if truncated after pagination attempt
                if (currentPageUri || totalRowsFetched > maxRows) {
                     wasTruncated = true;
                     console.log("Results potentially truncated after pagination.");
                }
            }

            console.log(`Query finished processing. Total rows fetched: ${totalRowsFetched}. Columns: ${columns?.length ?? 0}`);

            // --- Store result state and limit rows for display --- 
            lastSuccessfulQueryResult = null; 
            let displayRows = [...results]; // Use potentially paginated results
            const finalTotalRows = totalRowsFetched;

            // Store the potentially paginated results (up to maxRows or full set)
            if (columns && columns.length > 0) {
                 lastSuccessfulQueryResult = {
                    columns: columns,
                    // Store ALL fetched rows for potential export, even if > maxRows
                    rows: results, 
                    query: sql,
                    // nextUri here indicates if there was potentially MORE after we stopped fetching
                    nextUri: nextUriFromResponse, 
                    infoUri: infoUriFromResponse,
                    id: queryIdFromResponse
                };
                
                // Slice for display if needed
                if (results.length > maxRows) {
                    console.log(`Limiting display rows from ${totalRowsFetched} to ${maxRows}`);
                    displayRows = results.slice(0, maxRows); 
                    wasTruncated = true;
                }

                // Update truncation flag if pagination stopped due to hitting maxRows
                if (!currentPageUri && totalRowsFetched >= maxRows) {
                    // We might have fetched exactly maxRows but there could have been more
                    // Or we fetched > maxRows and sliced. Either way, consider truncated.
                    // Exception: If the very last page happened to bring us exactly to maxRows and had no nextUri.
                    // It's safer to assume truncation if we hit the limit.
                    wasTruncated = true;
                }
                
                // Send display results to view provider for the specific tab
                 resultsViewProvider.showResultsForTab(tabId, {
                    columns,
                    rows: results.slice(0, maxRows),
                    query: sql,
                    wasTruncated: results.length > maxRows || !!currentPageUri,
                    totalRowsInFirstBatch: results.length,
                    queryId: queryIdFromResponse,
                    infoUri: infoUriFromResponse,
                    nextUri: currentPageUri
                });
            } else {
                 // No columns found...
                 console.warn("Could not determine columns or no columns returned...");
                 resultsViewProvider.showStatusMessage('Query finished successfully (no tabular data).');
            }
            
        } catch (error: any) {
            console.error("Trino Query Error:", error);
            const errorMessage = error.message || 'Unknown error during query execution.';
            vscode.window.showErrorMessage(`Trino Query Failed: ${errorMessage}`);
            resultsViewProvider?.showErrorForTab(tabId, errorMessage, error.stack, sql, queryPreview);
        }
    });

    context.subscriptions.push(runQueryCommand);
}

/**
 * This method is called when your extension is deactivated.
 */
export function deactivate() {
    console.log('Extension "presto-runner" is now deactivated.');
    // Cleanup resources if needed
} 