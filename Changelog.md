# Changelog

## [Unreleased]

### Added
- Initial VS Code extension setup for Presto/Trino database connections
- Command palette integration with `Presto: Run Query` command
- Code lens provider for executing SQL queries directly from editor
- Results view panel with Tabulator integration for data visualization
- Configuration setting for maximum rows to display (`presto.maxRowsToDisplay`)
- Pagination support for fetching large result sets
- Visual styling improvements for the results grid:
  - Integration with VS Code theme
  - Row number column
  - Improved formatting and density
  - Header styling enhancements
- Connection handling with authentication support
- Error handling and display in the results view
- Query execution status indicators
- Dynamic theme color integration with VS Code:
  - Table adapts to user's selected theme
  - Row backgrounds, text colors, and borders match theme
  - Support for light, dark, and high-contrast themes
  - Live theme updates when user changes VS Code theme

### Changed
- Replaced Tabulator with AG Grid for the results view, providing enhanced features and a more modern grid experience.
- Updated results display to use Tabulator for better data visualization
- Improved results panel styling to better match VS Code themes
- Enhanced query result handling with pagination support
- Switched from `client.execute()` to `client.query()` for compatibility
- Refactored CSS to use theme variables for consistent styling

### Fixed
- Resolved pagination issues when fetching large result sets
- Fixed layout and styling issues in the results view
- Corrected variable declarations (let vs const) based on usage patterns
- Addressed linter errors and warnings
- Fixed module resolution for the Results View Provider
- Resolved connection and authentication issues with Trino client

### Developer Improvements
- Added ESLint configuration
- Configured TypeScript compilation settings
- Added proper module structure and organization
- Implemented better error handling and logging 
- Created theme-aware UI components for improved user experience 