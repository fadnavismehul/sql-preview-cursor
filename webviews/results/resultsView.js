// Make sure Tabulator library is loaded before this script runs (usually via HTML <script> tag)

// Check if agGrid is loaded
if (typeof agGrid === 'undefined') {
    console.error("AG Grid library not found. Make sure it is included in the HTML.");
    const errorDiv = document.getElementById('error-container');
    if (errorDiv) {
        errorDiv.textContent = "Critical Error: AG Grid library failed to load. Results cannot be displayed.";
        errorDiv.style.display = 'block';
    }
} else {
    // Get the VS Code API handle
    // eslint-disable-next-line no-undef
    const vscode = acquireVsCodeApi();

    // --- DOM Elements --- 
    const gridElement = document.getElementById('results-grid'); // Changed from tableElement
    const errorContainer = document.getElementById('error-container');
    const loadingIndicator = document.getElementById('loading-indicator');
    const statusMessageElement = document.getElementById('status-message');
    const rowCountInfoElement = document.getElementById('row-count-info');
    const truncationWarningElement = document.getElementById('truncation-warning');
    const exportButton = document.getElementById('export-button');

    // --- AG Grid Instance & Options --- 
    let gridOptions = null; // Will hold grid options
    let currentGridApi = null; // Will be the gridApi from AG Grid

    // --- State --- 
    // currentData and currentColumns might not be needed in the same way, AG Grid manages its own state.

    // --- Initialize Grid Function ---
    function initializeGrid(columns, data, wasTruncated, totalRowsInFirstBatch) {
        if (!gridElement) {
            console.error("Grid element #results-grid not found!");
            return;
        }

        // Clear previous grid if exists
        if (currentGridApi) {
            try {
                currentGridApi.destroy();
            } catch(e) { console.warn("Error destroying previous grid:", e); }
            currentGridApi = null;
        }
        // Ensure the grid div is empty before creating a new grid
        gridElement.innerHTML = '';

        // Transform columns for AG Grid
        const agGridColumnDefs = columns.map(col => ({
            headerName: col.name,
            field: col.name,
            sortable: true,
            filter: true, // Basic filter, can be 'agTextColumnFilter', true, etc.
            resizable: true,
            floatingFilter: true, // Similar to headerFilter: 'input'
            headerTooltip: `${col.name} (${col.type})`, // Show type in tooltip
            // Example for numeric alignment - this requires `type` on the colDef.
            // One way to handle type-specifics:
            // cellClass: isNumericType(col.type) ? 'ag-right-aligned-cell' : 'ag-left-aligned-cell',
            // Or AG Grid has built-in types:
            type: isNumericType(col.type) ? 'numericColumn' : undefined,
            // For value formatting (e.g. numbers, dates) - can be added later
            // valueFormatter: params => formatValue(params.value, col.type)
        }));

        // Add Row Number column (pinned to the left)
        const rowNumColDef = {
            headerName: '#',
            valueGetter: 'node.rowIndex + 1',
            width: 60, 
            pinned: 'left',
            resizable: false,
            sortable: false,
            filter: false,
            headerCheckboxSelection: false, // Optional: for row selection
            checkboxSelection: false      // Optional: for row selection
        };

        // Transform data for AG Grid (array of objects)
        const agGridRowData = data.map(row => {
            let obj = {};
            columns.forEach((col, i) => {
                obj[col.name] = row[i]; 
            });
            return obj;
        });

        gridOptions = {
            columnDefs: [rowNumColDef, ...agGridColumnDefs],
            rowData: agGridRowData,
            pagination: true,
            paginationPageSize: 50,
            paginationPageSizeSelector: [50, 100, 250, 500, 0], // 0 for 'all'
            domLayout: 'normal', // 'autoHeight' or 'normal' or 'print'
            // `height` is set on the div, AG Grid will fill it.
            // For column sizing to fill width:
            autoSizeStrategy: {
                type: 'fitGridWidth',
                defaultMinWidth: 100,
            },
            // Or make columns flexible
            // defaultColDef: {
            //     flex: 1,
            //     minWidth: 100, // ensure columns are not too small
            //     resizable: true,
            //     sortable: true,
            //     filter: true,
            // },
            animateRows: true,
            enableCellTextSelection: true, // Allows text selection for copying
            ensureDomOrder: true, // Important for text selection
            // For clipboard - AG Grid Community has basic copy, Enterprise has more features
            // suppressClipboardPaste: true, // if you don't want paste

            // No rows overlay
            overlayNoRowsTemplate: '<span style="padding: 10px; border: 1px solid grey; background: lightgrey;">No results to display</span>',
            // Loading overlay (can be customized)
            overlayLoadingTemplate: '<span class="ag-overlay-loading-center">Please wait while your rows are loading</span>',

            onGridReady: (params) => {
                currentGridApi = params.api;
                 // Example: auto-size columns to fit content after data loads
                // params.api.autoSizeAllColumns();
            },
        };

        // Create AG Grid instance
        // Ensure the grid div is in the DOM and visible before creating the grid
        if (gridElement) {
            new agGrid.Grid(gridElement, gridOptions);
        } else {
            console.error("AG Grid target element not found when creating grid.");
        }
        
        updateRowCount(data.length, totalRowsInFirstBatch, wasTruncated);

        if (exportButton) {
             exportButton.style.display = (totalRowsInFirstBatch > 0) ? 'inline-block' : 'none';
             // TODO: AG Grid export to CSV: currentGridApi.exportDataAsCsv();
             exportButton.onclick = () => {
                if (currentGridApi) {
                    currentGridApi.exportDataAsCsv();
                } else {
                    vscode.postMessage({ command: 'alert', text: 'Grid not available for export.' });
                }
            };
        }
    }

    // --- Helper Functions ---
    function updateRowCount(displayedCount, totalInBatch, wasTruncated) {
        if (rowCountInfoElement) {
            let text = `(${displayedCount} row${displayedCount !== 1 ? 's' : ''} shown`;
            if (wasTruncated) {
                 text += ` of ${totalInBatch} (first batch)`;
            }
            text += ')';
            rowCountInfoElement.textContent = text;
        }
        if (truncationWarningElement) {
             truncationWarningElement.style.display = wasTruncated ? 'inline' : 'none';
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
        const message = event.data; 

        if (loadingIndicator) loadingIndicator.style.display = 'none';
        
        if (message.type !== 'showLoading' && errorContainer) {
            errorContainer.textContent = '';
            errorContainer.style.display = 'none';
        }
        if (message.type !== 'showLoading' && statusMessageElement) {
             if (message.type !== 'statusMessage') {
                 statusMessageElement.textContent = 'Finished'; 
             }
        }
        if (message.type !== 'showLoading' && rowCountInfoElement) {
             if (message.type !== 'resultData') {
                  rowCountInfoElement.textContent = ''; 
                  if (truncationWarningElement) truncationWarningElement.style.display = 'none';
                  if (exportButton) exportButton.style.display = 'none';
             }
        }

        switch (message.type) {
            case 'showLoading':
                console.log("Received showLoading message");
                if (currentGridApi) currentGridApi.setGridOption('rowData', []); // Clear data
                if (loadingIndicator) loadingIndicator.style.display = 'flex';
                if (statusMessageElement) statusMessageElement.textContent = 'Executing query...';
                if (rowCountInfoElement) rowCountInfoElement.textContent = '';
                if (errorContainer) errorContainer.style.display = 'none';
                if (currentGridApi) currentGridApi.showLoadingOverlay();
                break;

            case 'resultData':
                console.log(`Received resultData: ${message.data?.rows?.length} rows shown`);
                console.log(`Truncated: ${message.data.wasTruncated}, Total in batch: ${message.data.totalRowsInFirstBatch}`);
                try {
                    if (currentGridApi) currentGridApi.hideOverlay(); // Hide loading overlay
                    initializeGrid(
                        message.data.columns, 
                        message.data.rows, 
                        message.data.wasTruncated, 
                        message.data.totalRowsInFirstBatch
                    );
                    if (statusMessageElement) statusMessageElement.textContent = 'Finished';
                    if (errorContainer) errorContainer.style.display = 'none';
                } catch (e) {
                    console.error("Error initializing grid:", e);
                    if (currentGridApi) currentGridApi.hideOverlay();
                    if (errorContainer) {
                        errorContainer.textContent = `Error displaying results: ${e.message}`;
                        errorContainer.style.display = 'block';
                    }
                    if (statusMessageElement) statusMessageElement.textContent = 'Error';
                }
                break;

            case 'queryError':
                console.error("Received queryError:", message.error);
                if (currentGridApi) {
                    currentGridApi.setGridOption('rowData', []);
                    currentGridApi.hideOverlay();
                }
                if (errorContainer) {
                    errorContainer.textContent = `Query Error: ${message.error.message}`;
                    if (message.error.details) {
                         console.error("Error Details:", message.error.details);
                    }
                    errorContainer.style.display = 'block';
                }
                if (statusMessageElement) statusMessageElement.textContent = 'Error';
                if (rowCountInfoElement) rowCountInfoElement.textContent = '';
                if (truncationWarningElement) truncationWarningElement.style.display = 'none';
                if (exportButton) exportButton.style.display = 'none';
                break;
                
            case 'statusMessage':
                console.log("Received statusMessage:", message.message);
                 if (currentGridApi) {
                    currentGridApi.setGridOption('rowData', []);
                    // Potentially show a specific overlay for status messages if desired
                    // currentGridApi.showNoRowsOverlay(); 
                 }
                 if (statusMessageElement) statusMessageElement.textContent = message.message;
                 if (rowCountInfoElement) rowCountInfoElement.textContent = '';
                 if (truncationWarningElement) truncationWarningElement.style.display = 'none';
                 if (exportButton) exportButton.style.display = 'none';
                 if (errorContainer) errorContainer.style.display = 'none';
                break;
        }
    });

    console.log("AG Grid results view script loaded and ready.");
} 