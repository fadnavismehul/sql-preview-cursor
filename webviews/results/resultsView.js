// Make sure Tabulator library is loaded before this script runs (usually via HTML <script> tag)

// Check if Tabulator is loaded
if (typeof Tabulator === 'undefined') {
    console.error("Tabulator library not found. Make sure it is included in the HTML.");
    // Display error in the webview itself
    const errorDiv = document.getElementById('error-container');
    if (errorDiv) {
        errorDiv.textContent = "Critical Error: Tabulator library failed to load. Results cannot be displayed.";
        errorDiv.style.display = 'block';
    }
} else {

    // Get the VS Code API handle
    // eslint-disable-next-line no-undef
    const vscode = acquireVsCodeApi();

    // --- DOM Elements --- 
    const tableElement = document.getElementById('results-table');
    const errorContainer = document.getElementById('error-container');
    const loadingIndicator = document.getElementById('loading-indicator');
    const statusMessageElement = document.getElementById('status-message');
    const rowCountElement = document.getElementById('row-count');

    // --- Tabulator Instance --- 
    let table = null; // Will be initialized when data arrives

    // --- State --- 
    let currentData = [];
    let currentColumns = [];

    // --- Initialize Table Function ---
    function initializeTable(columns, data) {
        if (!tableElement) return; // Should not happen

        // Clear previous table if exists
        if (table) {
            try {
                table.destroy();
            } catch(e) { console.warn("Error destroying previous table:", e); }
            table = null;
        }
        
        // Transform columns for Tabulator
        const tabulatorColumns = columns.map(col => ({
            title: col.name,
            field: col.name,
            headerFilter: "input", // Enable header filtering
            // Add formatter based on col.type if needed (e.g., for numbers, dates)
            // formatter: getFormatter(col.type),
            hozAlign: isNumericType(col.type) ? "right" : "left", // Align numbers right
            headerTooltip: `${col.name} (${col.type})` // Show type in tooltip
        }));

        // Transform data for Tabulator (array of objects)
        const tabulatorData = data.map(row => {
            let obj = {};
            columns.forEach((col, i) => {
                // Handle potential null/undefined values explicitly if necessary
                obj[col.name] = row[i]; 
            });
            return obj;
        });
        
        currentData = tabulatorData;
        currentColumns = tabulatorColumns;

        // Create Tabulator instance
        table = new Tabulator(tableElement, {
            data: tabulatorData,
            columns: tabulatorColumns,
            layout: "fitDataTable", // Adjust layout as needed fitData | fitColumns | fitDataTable
            placeholder: "No results", // Message when data is empty
            pagination: "local", // Enable local pagination
            paginationSize: 50, // Number of rows per page
            paginationSizeSelector: [50, 100, 250, 500, true], // Allow user to change page size
            movableColumns: true, // Allow column reordering
            resizableRows: true,    // Allow row height resizing 
            resizableColumns: true, // Allow column width resizing
            height: "calc(100vh - 80px)", // Example: Adjust height dynamically (consider controls height)
            // Add other Tabulator options as needed: grouping, sorting, etc.
            initialSort: [], // No initial sort by default
            clipboard: true, // Enable copying to clipboard
            clipboardCopyRowRange: "selected", // Copy selected rows
        });
        
        // Update row count display
        updateRowCount(data.length);
    }

    // --- Helper Functions ---
    function updateRowCount(count) {
        if (rowCountElement) {
            rowCountElement.textContent = `(${count} row${count !== 1 ? 's' : ''})`;
        }
    }
    
    function isNumericType(type) {
        if (!type) return false;
        const lowerType = type.toLowerCase();
        return lowerType.includes('int') || 
               lowerType.includes('double') || 
               lowerType.includes('float') || 
               lowerType.includes('decimal') || 
               lowerType.includes('numeric') ||
               lowerType.includes('real');
    }

    // --- Message Handling --- 
    window.addEventListener('message', event => {
        const message = event.data; // The JSON data sent from the extension

        // Hide loading indicator as soon as any message comes in
        if (loadingIndicator) loadingIndicator.style.display = 'none';
        
        // Clear previous errors/status unless it's a loading message
        if (message.type !== 'showLoading' && errorContainer) {
            errorContainer.textContent = '';
            errorContainer.style.display = 'none';
        }
        if (message.type !== 'showLoading' && statusMessageElement) {
             if (message.type !== 'statusMessage') {
                 statusMessageElement.textContent = 'Finished'; // Default status unless overridden
             }
        }
        if (message.type !== 'showLoading' && rowCountElement) {
             if (message.type !== 'resultData') {
                  rowCountElement.textContent = ''; // Clear count unless results are coming
             }
        }

        switch (message.type) {
            case 'showLoading':
                console.log("Received showLoading message");
                if (table) table.clearData(); // Clear existing table data
                if (loadingIndicator) loadingIndicator.style.display = 'flex';
                if (statusMessageElement) statusMessageElement.textContent = 'Executing query...';
                if (rowCountElement) rowCountElement.textContent = '';
                if (errorContainer) errorContainer.style.display = 'none';
                break;

            case 'resultData':
                console.log(`Received resultData: ${message.data?.rows?.length} rows`);
                try {
                    initializeTable(message.data.columns, message.data.rows);
                    if (statusMessageElement) statusMessageElement.textContent = 'Finished';
                    if (errorContainer) errorContainer.style.display = 'none';
                } catch (e) {
                    console.error("Error initializing table:", e);
                    if (errorContainer) {
                        errorContainer.textContent = `Error displaying results: ${e.message}`;
                        errorContainer.style.display = 'block';
                    }
                    if (statusMessageElement) statusMessageElement.textContent = 'Error';
                }
                break;

            case 'queryError':
                console.error("Received queryError:", message.error);
                if (table) table.clearData();
                if (errorContainer) {
                    errorContainer.textContent = `Query Error: ${message.error.message}`;
                    if (message.error.details) { // Add details if available
                         errorContainer.textContent += `\n\nDetails:\n${message.error.details}`;
                    }
                    errorContainer.style.display = 'block';
                }
                if (statusMessageElement) statusMessageElement.textContent = 'Error';
                if (rowCountElement) rowCountElement.textContent = '';
                break;
                
            case 'statusMessage':
                console.log("Received statusMessage:", message.message);
                 if (table) table.clearData();
                 if (statusMessageElement) statusMessageElement.textContent = message.message;
                 if (rowCountElement) rowCountElement.textContent = ''; // No rows for status messages
                 if (errorContainer) errorContainer.style.display = 'none';
                break;
        }
    });

    // Optional: Inform the extension host that the webview is ready
    // vscode.postMessage({ command: 'webviewReady' });
    console.log("Results view script loaded and ready.");
} 