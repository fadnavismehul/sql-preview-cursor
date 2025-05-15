# Presto Query Runner for VS Code

A Visual Studio Code extension for connecting to Presto/Trino databases, running SQL queries, and visualizing results directly within your editor.

## Features

- **SQL Query Execution**: Run SQL queries against Presto/Trino databases directly from VS Code
- **Code Lens Integration**: Execute queries with a single click from SQL files
- **Interactive Results View**: View query results in a rich, interactive data grid
- **Pagination Support**: Handles large result sets efficiently
- **Export Capability**: Export results to CSV (coming soon)
- **Syntax Highlighting**: Proper SQL syntax highlighting
- **Connection Management**: Simple configuration via VS Code settings

## Technology Stack

- **VS Code Extension API**: Core extension framework
- **TypeScript**: Primary development language
- **Trino Client**: Node.js client for Presto/Trino database connections
- **Axios**: HTTP client for handling paginated query results
- **AG Grid**: Interactive data grid for displaying query results
- **ESLint**: Code quality and style enforcement

## Configuration

Add the following configuration to your VS Code `settings.json`:

```json
{
  "presto.host": "your-presto-host.example.com",
  "presto.port": 8080,
  "presto.catalog": "hive",
  "presto.schema": "default",
  "presto.user": "your-username",
  "presto.password": "your-password", // Optional
  "presto.basicAuth": false, // Set to true if using HTTP Basic Authentication
  "presto.maxRowsToDisplay": 1000 // Limit the number of rows to display
}
```

## Usage

### Running a Query

1. Open a SQL file or create a new file with the `.sql` extension
2. Write your SQL query
3. Click the "Run Query" Code Lens above your query, or:
4. Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P` on macOS)
5. Select "Presto: Run Query"

### Viewing Results

Results will appear in the "Presto Results" panel in the Activity Bar. The results view provides:

- Sortable columns (click column headers)
- Resizable columns (drag column borders)
- Copy functionality (right-click on cells)

## Project Structure

```
presto-runner/
├── src/
│   ├── extension.ts          # Main extension entry point
│   ├── resultsViewProvider.ts # Results view implementation
│   └── PrestoCodeLensProvider.ts # Code lens integration
├── webviews/
│   └── results/              # Results view UI components
│       ├── resultsView.js    # Client-side webview logic
│       └── resultsView.css   # Styling for results view
└── package.json              # Extension manifest
```

## Development

### Prerequisites

- Node.js (v14+)
- npm or yarn
- VS Code

### Setup

1. Clone the repository
2. Run `npm install` to install dependencies
3. Open the project in VS Code
4. Press F5 to start debugging 