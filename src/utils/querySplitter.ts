/**
 * Splits a SQL text into individual statements, respecting strings and comments.
 *
 * @param text The SQL text to split.
 * @returns An array of individual SQL statements.
 */
export function splitSqlQueries(text: string): string[] {
  const queries: string[] = [];
  let currentQuery = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    // Handle state changes
    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
      }
    } else if (inBlockComment) {
      if (char === '*' && nextChar === '/') {
        inBlockComment = false;
        currentQuery += char + nextChar;
        i++; // Skip next char
        continue;
      }
    } else if (inSingleQuote) {
      if (char === "'" && text[i - 1] !== '\\') {
        // Simple escape check
        // Handle double single quotes as escape in SQL
        if (nextChar === "'") {
          currentQuery += char + nextChar;
          i++;
          continue;
        }
        inSingleQuote = false;
      }
    } else if (inDoubleQuote) {
      if (char === '"' && text[i - 1] !== '\\') {
        if (nextChar === '"') {
          currentQuery += char + nextChar;
          i++;
          continue;
        }
        inDoubleQuote = false;
      }
    } else {
      // Not in any special state
      if (char === '-' && nextChar === '-') {
        inLineComment = true;
      } else if (char === '/' && nextChar === '*') {
        inBlockComment = true;
      } else if (char === "'") {
        inSingleQuote = true;
      } else if (char === '"') {
        inDoubleQuote = true;
      } else if (char === ';') {
        // Found a statement terminator
        if (currentQuery.trim().length > 0) {
          queries.push(currentQuery.trim());
        }
        currentQuery = '';
        continue;
      }
    }

    currentQuery += char;
  }

  // Add the last query if exists
  if (currentQuery.trim().length > 0) {
    queries.push(currentQuery.trim());
  }

  return queries;
}

/**
 * Finds the query at a specific offset in the text.
 *
 * @param text The full SQL text.
 * @param offset The character offset to find the query for.
 * @returns The query string at the offset, or null if not found.
 */
export function getQueryAtOffset(text: string, offset: number): string | null {
  // This is a simplified version that reuses the splitter.
  // Ideally we would map ranges, but for now we can just check which split query contains the offset.
  // However, since we trim queries in splitSqlQueries, we lose exact offsets.
  // We need a version that preserves offsets or just iterates again.

  // Let's reimplement a simple iterator that tracks ranges
  let currentStart = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
      }
    } else if (inBlockComment) {
      if (char === '*' && nextChar === '/') {
        inBlockComment = false;
        i++;
      }
    } else if (inSingleQuote) {
      if (char === "'" && text[i - 1] !== '\\') {
        if (nextChar === "'") {
          i++;
        } else {
          inSingleQuote = false;
        }
      }
    } else if (inDoubleQuote) {
      if (char === '"' && text[i - 1] !== '\\') {
        if (nextChar === '"') {
          i++;
        } else {
          inDoubleQuote = false;
        }
      }
    } else {
      if (char === '-' && nextChar === '-') {
        inLineComment = true;
      } else if (char === '/' && nextChar === '*') {
        inBlockComment = true;
      } else if (char === "'") {
        inSingleQuote = true;
      } else if (char === '"') {
        inDoubleQuote = true;
      } else if (char === ';') {
        // End of statement
        if (offset >= currentStart && offset <= i) {
          return text.substring(currentStart, i).trim();
        }
        currentStart = i + 1;
      }
    }
  }

  // Check last segment
  if (offset >= currentStart && offset <= text.length) {
    const lastQuery = text.substring(currentStart).trim();
    return lastQuery.length > 0 ? lastQuery : null;
  }

  return null;
}
