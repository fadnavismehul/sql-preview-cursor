import * as vscode from 'vscode';

/**
 * Provides CodeLens actions (like "Run Query") above SQL statements.
 */
export class PrestoCodeLensProvider implements vscode.CodeLensProvider {

    // Optional: Add event emitter if you want to refresh lenses on demand
    // private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    // readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

    constructor() {
        // Default constructor - no initialization needed
    }

    /**
     * Computes and returns the CodeLenses for a given text document.
     * @param document The document to provide CodeLenses for.
     * @param token A cancellation token.
     * @returns An array of CodeLenses or a promise that resolves to an array.
     */
    provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CodeLens[]> {
        const codeLenses: vscode.CodeLens[] = [];
        const text = document.getText();
        
        // Basic semicolon splitting - WARNING: Naive and will fail with semicolons in comments/strings
        // A more robust parser (e.g., using a dedicated SQL parsing library or regex) is recommended for production.
        const queries = text.split(/;\s*?(?=\S)/gm); // Split by semicolon followed by optional whitespace, but only if followed by non-whitespace (attempts to avoid splitting mid-line comments)
        
        let currentOffset = 0;
        for (const query of queries) {
            const trimmedQuery = query.trim();
            if (trimmedQuery.length === 0) {
                currentOffset += query.length + 1; // +1 for the semicolon
                continue;
            }

            const startOffset = text.indexOf(trimmedQuery, currentOffset);
            if (startOffset === -1) {
                 console.warn("Could not find query segment offset. Skipping CodeLens.");
                 currentOffset += query.length + 1;
                 continue;
            }
            const endOffset = startOffset + trimmedQuery.length;

            const startPos = document.positionAt(startOffset);
            const endPos = document.positionAt(endOffset);
            const range = new vscode.Range(startPos, endPos);

            // Ensure the range is valid and doesn't start/end mid-line unnecessarily
            // Find the first non-whitespace character line for the start
            let actualStartLine = startPos.line;
            while (actualStartLine < endPos.line && document.lineAt(actualStartLine).isEmptyOrWhitespace) {
                actualStartLine++;
            }
            const firstCharIndex = document.lineAt(actualStartLine).firstNonWhitespaceCharacterIndex;
            const adjustedStartPos = new vscode.Position(actualStartLine, firstCharIndex);
            
            // Use the line where the query starts for the CodeLens position
            const lensRange = new vscode.Range(adjustedStartPos, adjustedStartPos); 

            const command: vscode.Command = {
                title: "▶️ Run Query",
                                    command: 'sql.runCursorQuery',
                arguments: [trimmedQuery] // Pass the identified SQL query text
            };

            codeLenses.push(new vscode.CodeLens(lensRange, command));

            // Update offset for the next search
            currentOffset = endOffset;
        }

        return codeLenses;
    }

    // Optional: Implement resolveCodeLens if you need to compute commands asynchronously
    // resolveCodeLens?(codeLens: vscode.CodeLens, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CodeLens> {
    //     // If provideCodeLenses is fast, this might not be needed
    //     return codeLens;
    // }
} 