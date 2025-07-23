# SQL Preview for VS Code

A Visual Studio Code extension for connecting to Presto/Trino databases, running SQL queries, and visualizing results directly within your editor.

## Features

- **SQL Query Execution**: Run SQL queries against Presto/Trino databases directly from VS Code
- **Code Lens Integration**: Execute queries with a single click from SQL files
- **Interactive Results View**: View query results in a rich, interactive data grid
- **Pagination Support**: Handles large result sets efficiently
- **Export Capability**: Export results to CSV (coming soon)
- **Syntax Highlighting**: Proper SQL syntax highlighting
- **Connection Management**: Simple configuration via VS Code settings
- **Secure Password Storage**: Passwords stored securely using VS Code's encrypted SecretStorage API with convenient Settings UI

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
  "sqlPreview.host": "your-presto-host.example.com",
  "sqlPreview.port": 443,
  "sqlPreview.catalog": "hive",
  "sqlPreview.schema": "default",
  "sqlPreview.user": "your-username",
  "sqlPreview.ssl": true, // Enable SSL
  "sqlPreview.sslVerify": true, // Verify SSL certificate
  "sqlPreview.maxRowsToDisplay": 500 // Limit the number of rows to display
}
```

### Secure Password Management

For security reasons, passwords are **never stored as plaintext**. You have multiple ways to manage your password securely:

#### **Option 1: Settings UI (Recommended)**
1. Open VS Code Settings (`Ctrl+,` / `Cmd+,`)
2. Search for "SQL Preview"
3. Find the "Password" field and click **"Set Password"** button
4. Enter your password in the secure dialog

#### **Option 2: Command Palette**
1. **Set Password**: Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run `SQL Preview: Set Database Password`
2. **Clear Password**: Run `SQL Preview: Clear Stored Password` to remove the stored password

The password field in settings will show `[Password Set]` when a password is stored securely. Passwords are encrypted using VS Code's built-in SecretStorage API and the operating system's credential manager.

## Usage

### Running a Query

1. Open a SQL file or create a new file with the `.sql` extension
2. Write your SQL query
3. Click the "Run Query" Code Lens above your query, or:
4. Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P` on macOS)
5. Select "SQL Preview: Run Query Under Cursor"

### Managing Database Password

For secure authentication, you can set your password in two convenient ways:

#### **Via Settings (Easiest)**
1. Open Settings → Search "SQL Preview" → Click "Set Password" button next to the Password field
2. The field will show `[Password Set]` when configured

#### **Via Command Palette**
1. **Set Password**: `SQL Preview: Set Database Password` - Enter your password in a secure input field
2. **Clear Password**: `SQL Preview: Clear Stored Password` - Remove the stored password

The password is stored securely using OS-level encryption and never appears in your settings files.

### Viewing Results

Results will appear in the "SQL Preview" panel in the Activity Bar. The results view provides:

- Sortable columns (click column headers)
- Filterable columns (using floating filters below column headers)
- Resizable columns (drag column borders)
- Copy functionality (right-click on cells)

## Project Structure

```
sql-preview/
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