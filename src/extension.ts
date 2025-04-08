import * as vscode from 'vscode';
// Use NAMED import for Trino and BasicAuth
import { Trino, BasicAuth } from 'trino-client'; 
import { PrestoCodeLensProvider } from './PrestoCodeLensProvider'; // Corrected filename casing
import { ResultsViewProvider } from './resultsViewProvider';

let resultsViewProvider: ResultsViewProvider | undefined;

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
    const runQueryCommand = vscode.commands.registerCommand('presto.runCursorQuery', async (sqlFromCodeLens: string) => {
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

        resultsViewProvider.showLoading();

        const config = vscode.workspace.getConfiguration('presto');
        const host = config.get<string>('host', 'localhost');
        const port = config.get<number>('port', 8080);
        const user = config.get<string>('user', 'user');
        const catalog = config.get<string>('catalog') || undefined;
        const schema = config.get<string>('schema') || undefined;
        const password = config.get<string>('password') || undefined;
        const ssl = config.get<boolean>('ssl', false);
        const sslVerify = config.get<boolean>('sslVerify', true);

        // Define options structure inline, don't use ClientOptions type
        const clientOptions: any = { // Use 'any' or define an inline interface if preferred
            server: `${ssl ? 'https' : 'http'}://${host}:${port}`,
            user: user,
            catalog: catalog,
            schema: schema,
            ssl: ssl ? { rejectUnauthorized: sslVerify } : undefined,
            // basic_auth will be set below if password exists
        };

        // Add basic authentication if password is provided
        if (password) {
            // According to trino-client docs, auth goes here, not basic_auth key
            clientOptions.auth = new BasicAuth(user, password); 
        }

        // Instantiate using the static Trino.create factory method
        const client = Trino.create(clientOptions); 

        try {
            console.log(`Executing query: ${sql.substring(0, 100)}...`);

            // --- Data variables ---
            let results: any[][] = [];
            let columns: { name: string; type: string }[] | null = null;

            // --- ATTEMPT 1: Try client.execute() first (Speculative) ---
            let executeSucceeded = false;
            // Use type assertion to check for the method without compiler errors
            if (typeof (client as any).execute === 'function') { 
                console.log("Attempting client.execute()...");
                try {
                    // Assuming execute might return a single object with results
                    // Adjust the expected return type based on potential library structure
                    const queryResultData: { columns?: any[], data?: any[][] } | any = await (client as any).execute(sql);
                    console.log("client.execute() raw result:", JSON.stringify(queryResultData, null, 2));

                    // Check if the result looks valid (has columns and data arrays)
                    if (queryResultData && Array.isArray(queryResultData.columns) && Array.isArray(queryResultData.data)) {
                        console.log("Processing results from client.execute().");
                        columns = queryResultData.columns.map((col: { name: string; type: string }) => ({ 
                            name: col.name, 
                            type: col.type 
                        }));
                        results = queryResultData.data;
                        executeSucceeded = true; // Mark success
                    } else {
                        console.warn("client.execute() result format unexpected or missing columns/data.");
                    }
                } catch (execError: any) {
                    console.warn("client.execute() failed:", execError.message, ". Falling back to client.query().");
                }
            } else {
                console.log("client.execute() method not found.");
            }

            // --- FALLBACK or if execute failed: Use client.query() --- 
            if (!executeSucceeded) {
                console.log("Falling back to client.query() iterator...");
                const queryIter = await client.query(sql);
                
                console.log("(Fallback) Attempting to get FIRST result from iterator...");
                
                // --- Get the first result from the iterator --- 
                const firstIteration = await queryIter.next();
                const firstQueryResult = firstIteration.value;
                const firstDone = firstIteration.done;
                
                console.log(`(Fallback) First iteration result: done = ${firstDone}`);
                
                if (firstQueryResult) {
                    console.log("(Fallback) Raw FIRST queryResult value:", JSON.stringify(firstQueryResult, null, 2));
                    
                    // --- Process data/columns from the FIRST result --- 
                    if (firstQueryResult.columns && Array.isArray(firstQueryResult.columns)) {
                        console.log("(Fallback) Detected columns in FIRST result.");
                        columns = firstQueryResult.columns.map((col: { name: string; type: string }) => ({ 
                            name: col.name, 
                            type: col.type 
                        }));
                    }
                    if (firstQueryResult.data && Array.isArray(firstQueryResult.data)) {
                        console.log(`(Fallback) Detected ${firstQueryResult.data.length} data rows in FIRST result.`);
                        results.push(...firstQueryResult.data);
                    }
                    // --- End processing first result --- 
                    
                    // We could potentially check firstQueryResult.nextUri here if needed later
                    // but for now, we assume the first result is all we get from this iterator.
                    
                } else {
                     console.log("(Fallback) First iteration had no value.");
                }
                
                // Check if the iterator immediately reported done, even if there was a value
                if(firstDone) {
                    console.log("(Fallback) Iterator reported DONE on first call.");
                }
                
                console.log("(Fallback) Finished attempting to get first result.");
                 // --- No further looping needed as the iterator seems broken --- 
            }
            // --- End Fallback ---
            
            console.log(`Query finished processing. Columns: ${columns?.length ?? 0}, Rows: ${results.length}`);

            // --- Send results (or status) to view provider --- 
            if (columns && columns.length > 0) {
                 resultsViewProvider.showResults({
                    columns: columns,
                    rows: results,
                    query: sql 
                });
            } else {
                // If columns is still null or empty after trying both methods
                console.warn("Could not determine columns or no columns returned after trying execute/query.");
                resultsViewProvider.showStatusMessage('Query finished successfully (no tabular data).');
            }
            
        } catch (error: any) {
            console.error("Trino Query Error:", error);
            const errorMessage = error.message || 'Unknown error during query execution.';
            vscode.window.showErrorMessage(`Trino Query Failed: ${errorMessage}`);
            resultsViewProvider?.showError(errorMessage, error.stack);
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