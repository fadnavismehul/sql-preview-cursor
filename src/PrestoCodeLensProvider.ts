import * as vscode from 'vscode';
import { splitSqlQueries } from './utils/querySplitter';

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
  provideCodeLenses(document: vscode.TextDocument): vscode.ProviderResult<vscode.CodeLens[]> {
    const codeLenses: vscode.CodeLens[] = [];
    const text = document.getText();

    // Use robust splitter that handles comments and strings correctly
    const queries = splitSqlQueries(text);

    let currentOffset = 0;
    for (const query of queries) {
      const trimmedQuery = query.trim();
      if (trimmedQuery.length === 0) {
        continue;
      }

      // Find the start offset of this query
      // Note: This simple indexOf approach might still be slightly fragile if the same query appears multiple times
      // but since we update currentOffset, it should find the next occurrence.
      // Ideally splitSqlQueries would return ranges, but this is a good improvement over regex.
      const startOffset = text.indexOf(trimmedQuery, currentOffset);
      if (startOffset === -1) {
        // Could not find query segment offset. Skipping CodeLens.
        // This shouldn't happen if splitter works correctly, but safety first.
        currentOffset += query.length;
        continue;
      }
      const endOffset = startOffset + trimmedQuery.length;

      const startPos = document.positionAt(startOffset);
      const endPos = document.positionAt(endOffset);
      // const range = new vscode.Range(startPos, endPos); // Currently unused

      // Ensure the range is valid and doesn't start/end mid-line unnecessarily
      // Find the first non-whitespace character line for the start
      let actualStartLine = startPos.line;
      while (
        actualStartLine < endPos.line &&
        document.lineAt(actualStartLine).isEmptyOrWhitespace
      ) {
        actualStartLine++;
      }
      const firstCharIndex = document.lineAt(actualStartLine).firstNonWhitespaceCharacterIndex;
      const adjustedStartPos = new vscode.Position(actualStartLine, firstCharIndex);

      // Use the line where the query starts for the CodeLens position
      const lensRange = new vscode.Range(adjustedStartPos, adjustedStartPos);

      // Create two commands - Run and Run (+ Tab)
      const runCommand: vscode.Command = {
        title: '▶️ Run',
        command: 'sql.runQuery',
        arguments: [trimmedQuery], // Pass the identified SQL query text
      };

      const runNewTabCommand: vscode.Command = {
        title: '▶️➕ Run (+ Tab)',
        command: 'sql.runQueryNewTab',
        arguments: [trimmedQuery], // Pass the identified SQL query text
      };

      codeLenses.push(new vscode.CodeLens(lensRange, runCommand));

      // Create a second range for the "Run (+ Tab)" command, slightly offset
      const newTabLensRange = new vscode.Range(
        new vscode.Position(adjustedStartPos.line, adjustedStartPos.character + 1),
        new vscode.Position(adjustedStartPos.line, adjustedStartPos.character + 1)
      );
      codeLenses.push(new vscode.CodeLens(newTabLensRange, runNewTabCommand));

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
