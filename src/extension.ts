import * as vscode from 'vscode';
// Use NAMED import for Trino and BasicAuth
import { Trino, BasicAuth } from 'trino-client';
import { PrestoCodeLensProvider } from './PrestoCodeLensProvider'; // Corrected filename casing
import { ResultsViewProvider } from './resultsViewProvider';
import axios from 'axios'; // Import axios
import * as https from 'https'; // Import https for custom agent
import * as fs from 'fs'; // Import fs for file operations
import * as path from 'path'; // Import path for cross-platform path handling

let resultsViewProvider: ResultsViewProvider | undefined;

// Create output channel for logging
const outputChannel = vscode.window.createOutputChannel('SQL Preview');

// Secret storage key for database password
const PASSWORD_SECRET_KEY = 'sqlPreview.database.password';

// Type definitions for Trino/Presto responses
interface TrinoQueryResponse {
  error?: {
    message?: string;
    errorName?: string;
    stack?: string;
    errorCode?: string;
  };
  stats?: {
    state?: string;
  };
  columns?: Array<{ name: string; type: string }>;
  data?: unknown[][];
  id?: string;
  nextUri?: string;
  infoUri?: string;
}

// --- Module-level state for last query results ---
// TODO: Store the full first batch and pagination info for potential export
// interface LastQueryResult {
//     columns: { name: string; type: string }[];
//     rows: any[][];
//     query: string;
//     nextUri?: string; // URI for the next page, if any
//     infoUri?: string; // Info URI for the query
//     id?: string;      // Query ID
// }
// TODO: Implement result caching for export functionality
// let lastSuccessfulQueryResult: LastQueryResult | null = null;
// --- End state ---

// Create a reusable HTTPS agent for axios requests (important for custom SSL verification)
const createHttpsAgent = (sslVerify: boolean) => {
  return new https.Agent({
    rejectUnauthorized: sslVerify,
  });
};

/**
 * Securely retrieves the stored password from VS Code's secret storage
 */
async function getStoredPassword(context: vscode.ExtensionContext): Promise<string | undefined> {
  return await context.secrets.get(PASSWORD_SECRET_KEY);
}

/**
 * Securely stores the password in VS Code's secret storage
 */
async function setStoredPassword(
  context: vscode.ExtensionContext,
  password: string
): Promise<void> {
  await context.secrets.store(PASSWORD_SECRET_KEY, password);
}

/**
 * Clears the stored password from VS Code's secret storage
 */
async function clearStoredPassword(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(PASSWORD_SECRET_KEY);
}

/**
 * Updates the password status display in settings
 */
async function updatePasswordStatus(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('sqlPreview');
  const hasPassword = (await getStoredPassword(context)) !== undefined;

  // Update the display value in settings
  await config.update(
    'password',
    hasPassword ? '[Password Set]' : '',
    vscode.ConfigurationTarget.Global
  );
}

/**
 * This method is called when your extension is activated.
 * Your extension is activated the very first time the command is executed
 * or when a file with the language ID 'sql' is opened.
 */
export function activate(context: vscode.ExtensionContext) {
  // console.log('Congratulations, your extension "presto-runner" is now active!');

  // Validate extension context and URI
  if (!context || !context.extensionUri) {
    outputChannel.appendLine('ERROR: Invalid extension context or URI during activation');
    vscode.window.showErrorMessage('SQL Preview: Extension failed to activate - invalid context');
    return;
  }

  // Validate extension path on Windows and other platforms
  const extensionPath = context.extensionUri.fsPath;
  if (!extensionPath || extensionPath.trim() === '') {
    outputChannel.appendLine('ERROR: Extension path is empty or invalid');
    vscode.window.showErrorMessage('SQL Preview: Extension failed to activate - invalid path');
    return;
  }

  // Normalize the path to handle Windows/Unix path differences
  const normalizedPath = path.normalize(extensionPath);
  if (!normalizedPath || normalizedPath.trim() === '') {
    outputChannel.appendLine('ERROR: Normalized extension path is empty');
    vscode.window.showErrorMessage(
      'SQL Preview: Extension failed to activate - path normalization failed'
    );
    return;
  }

  // Check if the extension directory exists (additional safety check)
  try {
    if (!fs.existsSync(normalizedPath)) {
      outputChannel.appendLine(`ERROR: Extension directory does not exist: ${normalizedPath}`);
      vscode.window.showErrorMessage('SQL Preview: Extension directory not found');
      return;
    }
  } catch (error) {
    outputChannel.appendLine(`ERROR: Error checking extension directory: ${error}`);
    // Continue anyway as this might be a permissions issue
  }

  try {
    // Register the Results Webview View Provider with enhanced error handling
    resultsViewProvider = new ResultsViewProvider(context.extensionUri);

    // Attempt to register the webview provider with additional validation
    const webviewRegistration = vscode.window.registerWebviewViewProvider(
      ResultsViewProvider.viewType,
      resultsViewProvider
    );

    context.subscriptions.push(webviewRegistration);
    outputChannel.appendLine('Successfully registered webview view provider');
  } catch (error) {
    outputChannel.appendLine(`ERROR: Error registering webview provider: ${error}`);

    // Instead of completely failing, show warning and continue with reduced functionality
    vscode.window.showWarningMessage(
      `SQL Preview: Webview provider registration failed (${error}). Some features may not work properly. Please check the SQL Preview output channel for details.`
    );

    // Continue execution to at least enable other features like CodeLens
    outputChannel.appendLine('Continuing extension activation with reduced functionality...');
  }

  // Register the CodeLens provider for SQL files
  const codeLensProvider = vscode.languages.registerCodeLensProvider(
    { language: 'sql' },
    new PrestoCodeLensProvider()
  );

  // Update password status on activation
  updatePasswordStatus(context);

  // Register the command to set database password securely
  const setPasswordCommand = vscode.commands.registerCommand('sql.setPassword', async () => {
    const password = await vscode.window.showInputBox({
      prompt: 'Enter database password',
      password: true, // This hides the input
      placeHolder: 'Database password',
    });

    if (password !== undefined) {
      if (password.trim() === '') {
        await clearStoredPassword(context);
        await updatePasswordStatus(context);
        vscode.window.showInformationMessage('Database password cleared.');
      } else {
        await setStoredPassword(context, password);
        await updatePasswordStatus(context);
        vscode.window.showInformationMessage('Database password stored securely.');
      }
    }
  });

  // Register the command for setting password from settings page
  const setPasswordFromSettingsCommand = vscode.commands.registerCommand(
    'sql.setPasswordFromSettings',
    async () => {
      const password = await vscode.window.showInputBox({
        prompt: 'Enter database password (securely stored using VS Code SecretStorage)',
        password: true,
        placeHolder: 'Database password',
        title: 'SQL Preview - Set Database Password',
      });

      if (password !== undefined) {
        if (password.trim() === '') {
          await clearStoredPassword(context);
          await updatePasswordStatus(context);
          vscode.window.showInformationMessage('Database password cleared.');
        } else {
          await setStoredPassword(context, password);
          await updatePasswordStatus(context);
          vscode.window.showInformationMessage('Database password stored securely.');
        }
      }
    }
  );

  // Register the command to clear stored password
  const clearPasswordCommand = vscode.commands.registerCommand('sql.clearPassword', async () => {
    await clearStoredPassword(context);
    await updatePasswordStatus(context);
    vscode.window.showInformationMessage('Database password cleared.');
  });

  // Listen for configuration changes to prevent direct password editing
  const configListener = vscode.workspace.onDidChangeConfiguration(async e => {
    if (e.affectsConfiguration('sqlPreview.password')) {
      // If someone tries to directly edit the password field, reset it and show instruction
      const config = vscode.workspace.getConfiguration('sqlPreview');
      const passwordValue = config.get<string>('password', '');

      if (passwordValue && passwordValue !== '[Password Set]') {
        // Reset the field and show message
        await updatePasswordStatus(context);
        vscode.window
          .showWarningMessage(
            'Please use "Set Password" command for secure password storage. Direct editing is not allowed.',
            'Set Password'
          )
          .then(selection => {
            if (selection === 'Set Password') {
              vscode.commands.executeCommand('sql.setPasswordFromSettings');
            }
          });
      }
    }
  });

  // Helper function for executing queries with different tab behaviors
  async function executeQuery(sqlFromCodeLens?: string, createNewTab = true) {
    if (!resultsViewProvider) {
      vscode.window.showErrorMessage(
        'SQL Preview: Results view is not available. The webview provider failed to initialize, possibly due to path issues on Windows. Please check the SQL Preview output channel for details.'
      );
      outputChannel.appendLine(
        'ERROR: Query execution attempted but resultsViewProvider is not available'
      );
      return;
    }

    let sql: string;

    if (sqlFromCodeLens) {
      // Called from CodeLens with SQL provided
      sql = sqlFromCodeLens.trim().replace(/;$/, '').trim();
    } else {
      // Called from keyboard shortcut - need to get SQL from editor
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('No active SQL editor found.');
        return;
      }

      // Check if there's a selection
      const selection = editor.selection;
      if (!selection.isEmpty) {
        // Use selected text
        sql = editor.document.getText(selection).trim().replace(/;$/, '').trim();
      } else {
        // No selection, find the query under cursor using similar logic to CodeLens
        const document = editor.document;
        const cursorPosition = editor.selection.active;
        const text = document.getText();

        // Split by semicolons (same logic as CodeLens provider)
        const queries = text.split(/;\s*?(?=\S)/gm);

        let currentOffset = 0;
        let foundQuery = '';

        for (const query of queries) {
          const trimmedQuery = query.trim();
          if (trimmedQuery.length === 0) {
            currentOffset += query.length + 1;
            continue;
          }

          const startOffset = text.indexOf(trimmedQuery, currentOffset);
          if (startOffset === -1) {
            currentOffset += query.length + 1;
            continue;
          }
          const endOffset = startOffset + trimmedQuery.length;

          const startPos = document.positionAt(startOffset);
          const endPos = document.positionAt(endOffset);

          // Check if cursor is within this query
          if (cursorPosition.isAfterOrEqual(startPos) && cursorPosition.isBeforeOrEqual(endPos)) {
            foundQuery = trimmedQuery;
            break;
          }

          currentOffset = endOffset;
        }

        if (!foundQuery) {
          vscode.window.showInformationMessage(
            'No SQL query found under cursor. Place cursor within a query or select text to run.'
          );
          return;
        }

        sql = foundQuery.trim().replace(/;$/, '').trim();
      }
    }

    if (!sql) {
      vscode.window.showInformationMessage('No SQL query found to run.');
      return;
    }

    // Handle tab creation based on the createNewTab parameter
    let tabId: string;
    const queryPreview = sql.length > 30 ? sql.substring(0, 30) + '...' : sql;

    if (createNewTab) {
      // Generate a unique tab ID for this query
      tabId = `tab-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      resultsViewProvider.createTabWithId(tabId, sql, queryPreview);
      resultsViewProvider.showLoadingForTab(tabId, sql, queryPreview);
    } else {
      // Use existing active tab or create a new one if none exists
      tabId = resultsViewProvider.getOrCreateActiveTabId(sql, queryPreview);
      resultsViewProvider.showLoadingForTab(tabId, sql, queryPreview);
    }

    const config = vscode.workspace.getConfiguration('sqlPreview');
    const host = config.get<string>('host', 'localhost');
    const port = config.get<number>('port', 8080);
    const user = config.get<string>('user', 'user');
    const catalog = config.get<string>('catalog') || undefined;
    const schema = config.get<string>('schema') || undefined;
    const ssl = config.get<boolean>('ssl', false);
    const sslVerify = config.get<boolean>('sslVerify', true);
    const maxRows = config.get<number>('maxRowsToDisplay', 500);

    // Get password securely from secret storage
    const password = await getStoredPassword(context);

    // --- Setup Authentication ---
    let basicAuthHeader: string | undefined;
    if (password) {
      basicAuthHeader = 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
    }
    // TODO: Handle other auth methods if needed

    // --- Setup Client Options (excluding auth for create) ---
    const clientOptions: {
      server: string;
      user: string;
      catalog: string;
      schema: string;
      ssl?: { rejectUnauthorized: boolean };
      auth?: BasicAuth;
    } = {
      server: `${ssl ? 'https' : 'http'}://${host}:${port}`,
      user: user,
      catalog: catalog || 'hive',
      schema: schema || 'default',
      ...(ssl ? { ssl: { rejectUnauthorized: sslVerify } } : {}),
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
      // console.log(`Executing query: ${sql.substring(0, 100)}...`);

      const results: unknown[][] = [];
      let columns: { name: string; type: string }[] | null = null;
      let rawResultObject: TrinoQueryResponse | null = null;
      let nextUriFromResponse: string | undefined = undefined;
      let infoUriFromResponse: string | undefined = undefined;
      let queryIdFromResponse: string | undefined = undefined;
      // let wasTruncated = false; // Currently unused, may be needed for future pagination logic
      let totalRowsFetched = 0;
      let currentPageUri: string | undefined = undefined; // Declare higher scope

      // --- Execute Query (Direct HTTP path to support Porta/Proxies) ---
      try {
        outputChannel.appendLine('[SQL Preview] Executing via direct HTTP POST /v1/statement');
        const statementUrl = `${ssl ? 'https' : 'http'}://${host}:${port}/v1/statement`;
        const httpsAgent = ssl ? createHttpsAgent(sslVerify) : undefined;
        const headers: Record<string, string> = {
          'Content-Type': 'text/plain',
          'X-Trino-User': user,
          'X-Trino-Catalog': catalog || 'hive',
          'X-Trino-Schema': schema || 'default',
          'X-Trino-Source': 'sql-preview',
          // Presto headers for compatibility
          'X-Presto-User': user,
          'X-Presto-Catalog': catalog || 'hive',
          'X-Presto-Schema': schema || 'default',
          'X-Presto-Source': 'sql-preview',
        };
        if (basicAuthHeader) {
          headers['Authorization'] = basicAuthHeader;
        }

        const directResp = await axios.post(statementUrl, sql, {
          headers,
          ...(httpsAgent ? { httpsAgent } : {}),
        });
        rawResultObject = directResp.data as TrinoQueryResponse;
      } catch (directError) {
        // Fall back to the client if direct HTTP path fails for reasons unrelated
        // to the original issue (e.g., network hiccup). This keeps behavior robust.
        outputChannel.appendLine('[SQL Preview] Direct POST failed, falling back to trino-client');
        const queryIter = await client.query(sql);
        const firstIteration = await queryIter.next();
        rawResultObject = firstIteration.value;
      }

      // Log the raw response for debugging
      // console.log('Raw response structure:', {
      //   hasValue: !!rawResultObject,
      //   hasError: !!rawResultObject?.error,
      //   hasStats: !!rawResultObject?.stats,
      //   state: rawResultObject?.stats?.state,
      //   hasColumns: !!rawResultObject?.columns,
      //   hasData: !!rawResultObject?.data,
      //   queryId: rawResultObject?.id,
      // });

      if (rawResultObject) {
        // console.log('Raw FIRST queryResult value received.'); // No need to log full object now

        // Check for error conditions in the response
        if (rawResultObject.error) {
          // Handle Presto/Trino error response
          const errorMessage =
            rawResultObject.error.message ||
            rawResultObject.error.errorName ||
            'Unknown query error';
          const errorDetails =
            rawResultObject.error.stack || rawResultObject.error.errorCode || undefined;
          // console.error('Presto Query Error from response:', rawResultObject.error);
          resultsViewProvider?.showErrorForTab(
            tabId,
            errorMessage,
            errorDetails,
            sql,
            queryPreview
          );
          return;
        }

        // Check for failed query state
        if (rawResultObject.stats && rawResultObject.stats.state === 'FAILED') {
          const errorMessage = 'Query execution failed';
          const errorDetails = rawResultObject.stats.state;
          // console.error('Presto Query Failed:', rawResultObject);
          resultsViewProvider?.showErrorForTab(
            tabId,
            errorMessage,
            errorDetails,
            sql,
            queryPreview
          );
          return;
        }

        if (rawResultObject.columns && Array.isArray(rawResultObject.columns)) {
          columns = rawResultObject.columns.map((col: { name: string; type: string }) => ({
            name: col.name,
            type: col.type,
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
      if (currentPageUri || (columns && columns.length > 0)) {
        let pageCount = 1;
        const httpsAgent = createHttpsAgent(sslVerify);

        while (currentPageUri && totalRowsFetched < maxRows) {
          pageCount++;
          // console.log(
          //   `Fetching page ${pageCount} (total rows so far: ${totalRowsFetched})... URI: ${currentPageUri}`
          // );

          try {
            // Cast the config to bypass type checking for Node.js specific options
            const config: {
              headers?: Record<string, string>;
              httpsAgent?: https.Agent;
            } = {};

            if (basicAuthHeader) {
              config.headers = { Authorization: basicAuthHeader };
            }
            if (httpsAgent) {
              config.httpsAgent = httpsAgent;
            }
            const response = await axios.get(currentPageUri, config);

            const pageData = response.data as TrinoQueryResponse;

            // Check for error conditions in pagination response
            if (pageData?.error) {
              const errorMessage =
                pageData.error.message || pageData.error.errorName || 'Error in paginated results';
              const errorDetails = pageData.error.stack || pageData.error.errorCode || undefined;
              // console.error('Presto Query Error in pagination:', pageData.error);
              resultsViewProvider?.showErrorForTab(
                tabId,
                errorMessage,
                errorDetails,
                sql,
                queryPreview
              );
              return;
            }

            if (!columns && pageData?.columns && Array.isArray(pageData.columns)) {
              columns = pageData.columns.map(col => ({ name: col.name, type: col.type }));
            }
            if (pageData?.data && Array.isArray(pageData.data)) {
              results.push(...pageData.data);
              totalRowsFetched += pageData.data.length;
              // console.log(
              //   `Fetched ${pageData.data.length} rows from page ${pageCount}. New total: ${totalRowsFetched}`
              // );
            }
            currentPageUri = pageData?.nextUri;
            if (!currentPageUri) {
              // console.log(
              //   'No nextUri found in page',
              //   pageCount,
              //   'response. Pagination complete.'
              // );
            }
          } catch (pageError: unknown) {
            // console.error(
            //   `Error fetching page ${pageCount} from ${currentPageUri}:`,
            //   pageError instanceof Error ? pageError.message : 'Unknown error'
            // );
            vscode.window.showWarningMessage(
              `Failed to fetch all results page ${pageCount}: ${pageError instanceof Error ? pageError.message : 'Unknown error'}`
            );
            currentPageUri = undefined; // Stop pagination on error
          }
        }

        // Check if truncated after pagination attempt
        if (currentPageUri || totalRowsFetched > maxRows) {
          // wasTruncated = true; // Currently unused
          // console.log('Results potentially truncated after pagination.');
        }
      }

      // console.log(
      //   `Query finished processing. Total rows fetched: ${totalRowsFetched}. Columns: ${columns?.length ?? 0}`
      // );

      // --- Store result state and limit rows for display ---
      // TODO: Re-enable result caching when export feature is implemented
      // lastSuccessfulQueryResult = null;
      // let displayRows = [...results]; // Use potentially paginated results
      // const finalTotalRows = totalRowsFetched;

      // Store the potentially paginated results (up to maxRows or full set)
      if (columns && columns.length > 0) {
        // TODO: Re-enable result caching when export feature is implemented
        // const resultToStore: LastQueryResult = {
        //     columns: columns,
        //     rows: results,
        //     query: sql,
        //     ...(nextUriFromResponse && { nextUri: nextUriFromResponse }),
        //     ...(infoUriFromResponse && { infoUri: infoUriFromResponse }),
        //     ...(queryIdFromResponse && { id: queryIdFromResponse })
        // };
        // lastSuccessfulQueryResult = resultToStore;

        // Slice for display if needed
        if (results.length > maxRows) {
          // console.log(`Limiting display rows from ${totalRowsFetched} to ${maxRows}`);
          // displayRows = results.slice(0, maxRows); // Currently unused
          // wasTruncated = true; // Currently unused
        }

        // Update truncation flag if pagination stopped due to hitting maxRows
        if (!currentPageUri && totalRowsFetched >= maxRows) {
          // We might have fetched exactly maxRows but there could have been more
          // Or we fetched > maxRows and sliced. Either way, consider truncated.
          // Exception: If the very last page happened to bring us exactly to maxRows and had no nextUri.
          // It's safer to assume truncation if we hit the limit.
          // wasTruncated = true; // Currently unused
        }

        // Send display results to view provider for the specific tab
        const displayData: {
          columns: Array<{ name: string; type: string }>;
          rows: unknown[][];
          query: string;
          wasTruncated: boolean;
          totalRowsInFirstBatch: number;
          queryId?: string;
          infoUri?: string;
          nextUri?: string;
        } = {
          columns,
          rows: results.slice(0, maxRows),
          query: sql,
          wasTruncated: results.length > maxRows || !!currentPageUri,
          totalRowsInFirstBatch: results.length,
        };

        // Only add optional properties if they have defined values
        if (queryIdFromResponse) {
          displayData.queryId = queryIdFromResponse;
        }
        if (infoUriFromResponse) {
          displayData.infoUri = infoUriFromResponse;
        }
        if (currentPageUri) {
          displayData.nextUri = currentPageUri;
        }

        resultsViewProvider.showResultsForTab(tabId, displayData);
      } else {
        // No columns found - this could be a DDL/DML statement or an error condition
        // console.warn('Could not determine columns or no columns returned...');

        // If we got a queryId, it likely executed successfully (DDL/DML)
        if (queryIdFromResponse) {
          resultsViewProvider.showStatusMessage(
            `Query executed successfully (Query ID: ${queryIdFromResponse}). No data returned - this is normal for DDL/DML operations.`
          );
        } else {
          // No queryId might indicate an issue - provide more guidance
          resultsViewProvider.showStatusMessage(
            'Query completed but returned no data. Check for syntax errors or verify the query produces results.'
          );
        }
      }
    } catch (error: unknown) {
      // console.error('Trino Query Error:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error during query execution.';
      vscode.window.showErrorMessage(`Trino Query Failed: ${errorMessage}`);
      resultsViewProvider?.showErrorForTab(
        tabId,
        errorMessage,
        error instanceof Error ? error.stack : undefined,
        sql,
        queryPreview
      );
    }
  }

  // Register the command to run query in the same tab
  const runQueryCommand = vscode.commands.registerCommand(
    'sql.runQuery',
    async (sqlFromCodeLens?: string) => {
      await executeQuery(sqlFromCodeLens, false); // Don't create new tab
    }
  );

  // Register the command to run query in a new tab
  const runQueryNewTabCommand = vscode.commands.registerCommand(
    'sql.runQueryNewTab',
    async (sqlFromCodeLens?: string) => {
      await executeQuery(sqlFromCodeLens, true); // Create new tab
    }
  );

  // Register the legacy command for backward compatibility
  const runCursorQueryCommand = vscode.commands.registerCommand(
    'sql.runCursorQuery',
    async (sqlFromCodeLens?: string) => {
      await executeQuery(sqlFromCodeLens, true); // Default to creating new tab for backward compatibility
    }
  );

  // Register the command to export full results
  const exportFullResultsCommand = vscode.commands.registerCommand(
    'sql.exportFullResults',
    async (options: { query: string; filePath: string; tabId: string }) => {
      await executeFullExport(context, options.query, options.filePath);
    }
  );

  // Register tab management commands
  const closeTabCommand = vscode.commands.registerCommand('sql.closeTab', () => {
    if (resultsViewProvider) {
      resultsViewProvider.closeActiveTab();
    }
  });

  const closeOtherTabsCommand = vscode.commands.registerCommand('sql.closeOtherTabs', () => {
    if (resultsViewProvider) {
      resultsViewProvider.closeOtherTabs();
    }
  });

  const closeAllTabsCommand = vscode.commands.registerCommand('sql.closeAllTabs', () => {
    if (resultsViewProvider) {
      resultsViewProvider.closeAllTabs();
    }
  });

  context.subscriptions.push(
    codeLensProvider,
    runQueryCommand,
    runQueryNewTabCommand,
    runCursorQueryCommand,
    closeTabCommand,
    closeOtherTabsCommand,
    closeAllTabsCommand,
    setPasswordCommand,
    setPasswordFromSettingsCommand,
    clearPasswordCommand,
    exportFullResultsCommand,
    configListener
  );
}

/**
 * Executes a query to get full results and exports them to CSV
 */
async function executeFullExport(
  context: vscode.ExtensionContext,
  query: string,
  filePath: string
): Promise<void> {
  try {
    // Show progress indicator
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Exporting full query results...',
        cancellable: false,
      },
      async progress => {
        progress.report({ increment: 0, message: 'Setting up connection...' });

        // Get configuration
        const config = vscode.workspace.getConfiguration('sqlPreview');
        const host = config.get<string>('host', 'localhost');
        const port = config.get<number>('port', 8080);
        const user = config.get<string>('user', 'user');
        const catalog = config.get<string>('catalog') || undefined;
        const schema = config.get<string>('schema') || undefined;
        const ssl = config.get<boolean>('ssl', false);
        const sslVerify = config.get<boolean>('sslVerify', true);

        // Get password securely from secret storage
        const password = await getStoredPassword(context);

        // Setup Authentication
        let basicAuthHeader: string | undefined;
        if (password) {
          basicAuthHeader = 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
        }

        // Setup Client Options
        const clientOptions: {
          server: string;
          user: string;
          catalog: string;
          schema: string;
          ssl?: { rejectUnauthorized: boolean };
          auth?: BasicAuth;
        } = {
          server: `${ssl ? 'https' : 'http'}://${host}:${port}`,
          user: user,
          catalog: catalog || 'hive',
          schema: schema || 'default',
          ...(ssl ? { ssl: { rejectUnauthorized: sslVerify } } : {}),
        };

        if (password) {
          clientOptions.auth = new BasicAuth(user, password);
        }

        progress.report({ increment: 20, message: 'Executing query...' });

        // Execute first page via direct POST (matches runtime path)
        const statementUrl = `${ssl ? 'https' : 'http'}://${host}:${port}/v1/statement`;
        const httpsAgent = ssl ? createHttpsAgent(sslVerify) : undefined;
        const headers: Record<string, string> = {
          'Content-Type': 'text/plain',
          'X-Trino-User': user,
          'X-Trino-Catalog': catalog || 'hive',
          'X-Trino-Schema': schema || 'default',
          'X-Trino-Source': 'sql-preview',
          'X-Presto-User': user,
          'X-Presto-Catalog': catalog || 'hive',
          'X-Presto-Schema': schema || 'default',
          'X-Presto-Source': 'sql-preview',
        };
        if (basicAuthHeader) {
          headers['Authorization'] = basicAuthHeader;
        }

        const initialResp = await axios.post(statementUrl, query, {
          headers,
          ...(httpsAgent ? { httpsAgent } : {}),
        });

        const allRows: unknown[][] = [];
        let columns: Array<{ name: string; type: string }> | undefined;
        let rawResultObject: TrinoQueryResponse = initialResp.data as TrinoQueryResponse;

        if (rawResultObject.error) {
          throw new Error(`Query failed: ${rawResultObject.error.message || 'Unknown error'}`);
        }

        if (rawResultObject.columns) {
          columns = rawResultObject.columns;
        }

        if (rawResultObject.data) {
          allRows.push(...rawResultObject.data);
        }

        // Fetch additional pages if they exist
        while (rawResultObject.nextUri) {
          progress.report({
            increment: Math.min(60, 20 + (allRows.length / 1000) * 20),
            message: `Fetching results... (${allRows.length} rows)`,
          });

          try {
            const nextPageResponse = await axios.get(rawResultObject.nextUri, {
              headers: basicAuthHeader ? { Authorization: basicAuthHeader } : {},
              ...(ssl ? { httpsAgent: createHttpsAgent(sslVerify) } : {}),
            });

            rawResultObject = nextPageResponse.data as TrinoQueryResponse;

            if (rawResultObject.error) {
              throw new Error(
                `Query failed on pagination: ${rawResultObject.error.message || 'Unknown error'}`
              );
            }

            if (rawResultObject.data) {
              allRows.push(...rawResultObject.data);
            }
          } catch (error: unknown) {
            if (error instanceof Error) {
              throw new Error(`Pagination request failed: ${error.message}`);
            }
            throw error;
          }
        }

        progress.report({ increment: 60, message: 'Generating CSV...' });

        if (!columns) {
          throw new Error('No columns returned from query');
        }

        // Generate CSV content
        const csvContent = generateCSV(columns, allRows);

        progress.report({ increment: 80, message: 'Writing file...' });

        // Write to file
        fs.writeFileSync(filePath, csvContent, 'utf8');

        progress.report({ increment: 100, message: 'Export complete!' });
      }
    );

    vscode.window.showInformationMessage(
      `Successfully exported ${query.length > 50 ? query.substring(0, 50) + '...' : query} results to ${filePath}`
    );
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to export full results: ${error}`);
  }
}

/**
 * Generates CSV content from columns and rows
 */
function generateCSV(columns: Array<{ name: string; type: string }>, rows: unknown[][]): string {
  let csvContent = '';

  // Add headers
  const headers = columns.map(col => col.name);
  csvContent += headers.map(header => `"${String(header).replace(/"/g, '""')}"`).join(',') + '\r\n';

  // Add data rows
  for (const row of rows) {
    const csvRow = row.map(value => {
      if (value === null || typeof value === 'undefined') {
        return '';
      }
      // Escape double quotes and ensure value is stringified
      return `"${String(value).replace(/"/g, '""')}"`;
    });
    csvContent += csvRow.join(',') + '\r\n';
  }

  return csvContent;
}

/**
 * This method is called when your extension is deactivated.
 */
export function deactivate() {
  // console.log('Extension "presto-runner" is now deactivated.');
  // Cleanup resources if needed
}
