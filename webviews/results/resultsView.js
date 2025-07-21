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

    // --- Helper function for CSV Export ---
    function exportSelectedRowsToCsv(gridApi) {
        const selectedNodes = gridApi.getSelectedNodes();
        if (!selectedNodes || selectedNodes.length === 0) {
            // vscode.postMessage({ command: 'showInfo', text: 'No rows selected for copying.' });
            return null;
        }

        // Get all displayed columns that have a 'field' (i.e., are data columns, not the row number column)
        const displayedDataColumns = gridApi.getAllDisplayedColumns().filter(col => col.getColDef().field);

        if (!displayedDataColumns.length) {
            // vscode.postMessage({ command: 'showInfo', text: 'No data columns to export.' });
            return null; 
        }

        // Create header row from displayed data columns
        const headerRow = displayedDataColumns.map(column => {
            const colDef = column.getColDef();
            return colDef.headerName || colDef.field; // Use headerName if available, otherwise field
        });

        let csvContent = "";
        // Add headers
        csvContent += headerRow.map(header => `"${String(header).replace(/"/g, '""')}"`).join(',') + '\\r\\n';

        // Create data rows
        selectedNodes.forEach(node => {
            const rowData = [];
            displayedDataColumns.forEach(column => {
                const colDef = column.getColDef(); // Field is guaranteed to exist due to filter above
                let value = node.data[colDef.field];
                if (value === null || typeof value === 'undefined') {
                    value = '';
                }
                // Escape double quotes and ensure value is stringified
                rowData.push(`"${String(value).replace(/"/g, '""')}"`);
            });
            csvContent += rowData.join(',') + '\\r\\n';
        });
        return csvContent;
    }

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
            floatingFilter: true,
            headerTooltip: `${col.name} (${col.type})`, // Show type in tooltip
            // AG Grid has built-in types for numeric columns
            type: isNumericType(col.type) ? 'numericColumn' : undefined,
            // For value formatting (e.g. numbers, dates) - can be added later
            // valueFormatter: params => formatValue(params.value, col.type)
        }));

        // Add Row Number column (pinned to the left)
        const rowNumColDef = {
            headerName: '#',
            valueGetter: params => params.node.rowIndex + 1,
            width: 45, 
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
            paginationPageSizeSelector: [50, 100, 250, 500],
            domLayout: 'normal', // 'autoHeight' or 'normal' or 'print'
            // `height` is set on the div, AG Grid will fill it.
            // Use defaultColDef to set column behavior instead of autoSizeStrategy
            defaultColDef: {
                resizable: true,
                sortable: true,
                filter: true,
                minWidth: 80, // minimum width to prevent columns from becoming too small
                // Don't set flex here - let autoSizeAllColumns() determine the width
            },
            animateRows: true,
            enableCellTextSelection: true, // Allows text selection for copying
            ensureDomOrder: true, // Important for text selection
            // For clipboard - AG Grid Community has basic copy, Enterprise has more features
            // suppressClipboardPaste: true, // if you don't want paste

            // No rows overlay
            overlayNoRowsTemplate: '<span style="padding: 10px; border: 1px solid grey; background: lightgrey;">No results to display</span>',
            // Loading overlay (can be customized)
            overlayLoadingTemplate: '<span class="ag-overlay-loading-center">Please wait while your rows are loading</span>',

            rowSelection: 'multiple', // Enable row selection
            suppressRowClickSelection: true, // We'll handle selection via cell click on the row number column

            icons: {
                // All custom SVGs are removed.
                // AG Grid will use its default Quartz theme icons for everything,
                // as they seem to be loading correctly now thanks to CSP adjustments.
            },

            onGridReady: (params) => {
                if (!currentGridApi) {
                    currentGridApi = params.api;
                    console.log("AG Grid: API set via onGridReady as fallback.");
                } else if (currentGridApi !== params.api) {
                    console.warn("AG Grid: API from createGrid and onGridReady mismatch. This is unexpected.");
                    currentGridApi = params.api;
                }

                // --- Debug Logging for Theme Variables ---
                console.log("--- AG Grid Theme Debug --- ");
                const computedStyles = getComputedStyle(document.body);
                const logStyle = (varName) => console.log(`${varName}: '${computedStyles.getPropertyValue(varName).trim()}'`)

                logStyle('--vscode-editor-foreground');
                logStyle('--vscode-editor-background');
                logStyle('--vscode-editorGutter-background');
                logStyle('--vscode-font-family');
                logStyle('--vscode-list-activeSelectionBackground');
                logStyle('--vscode-list-activeSelectionForeground');
                logStyle('--vscode-input-foreground');
                logStyle('--vscode-input-background');
                
                console.log("Grid Options used:", gridOptions);
                if (gridOptions.columnDefs && gridOptions.columnDefs.length > 1) {
                    console.log("Sample ColumnDef (data column):", gridOptions.columnDefs[1]);
                }
                console.log("Current Grid API:", currentGridApi);
                console.log("--- End AG Grid Theme Debug ---");
                // --- End Debug Logging ---

                console.log("AG Grid: Grid is ready.");
                console.log("AG Grid: Configured icons:", gridOptions.icons); // Log defined icons
                
                // Auto-size columns to fit content, including headers
                // Use timeout to ensure all data is rendered before sizing
                setTimeout(() => {
                    params.api.autoSizeAllColumns();
                }, 100);

                // Add keydown listener for custom CSV copy
                if (gridElement && currentGridApi) {
                    gridElement.removeEventListener('keydown', handleGridKeyDown); // Remove previous if any
                    gridElement.addEventListener('keydown', handleGridKeyDown);
                }
            },

            onColumnMenuVisibleChanged: (event) => {
                console.log("AG Grid: Column Menu Visible Changed:", event);
                console.log(` - Column ID: ${event.column ? event.column.getId() : 'N/A'}`);
                console.log(` - Is Visible: ${event.visible}`);
                if (event.column && event.visible) {
                    // Try to find the menu button element for this column header
                    const colId = event.column.getId();
                    const headerCell = gridElement.querySelector(`.ag-header-cell[col-id="${colId}"]`);
                    if (headerCell) {
                        const menuButton = headerCell.querySelector('.ag-header-cell-menu-button');
                        console.log(" - Menu button DOM element:", menuButton);
                        if (menuButton) {
                            console.log("   - Menu button inner HTML:", menuButton.innerHTML);
                            console.log("   - Menu button class list:", menuButton.classList);
                        }
                    }
                }
            },

            onCellClicked: (params) => {
                // If click is on the row number column, select the row
                if (params.colDef.headerName === '#') {
                    params.node.setSelected(!params.node.isSelected());
                }
            }
        };

        // Create AG Grid instance
        // Ensure the grid div is in the DOM and visible before creating the grid
        if (gridElement) {
            currentGridApi = agGrid.createGrid(gridElement, gridOptions);
            console.log("AG Grid: Instance created via createGrid.");
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

    // --- Grid Keydown Handler for Custom Copy ---
    function handleGridKeyDown(event) {
        if (!currentGridApi) return;

        // Check for Ctrl+C (Windows/Linux) or Cmd+C (Mac)
        if ((event.ctrlKey || event.metaKey) && event.key === 'c') {
            if (currentGridApi.getSelectedNodes().length > 0) {
                // Check if the focused element is part of the grid or an input inside the grid
                // This helps avoid overriding copy from filter inputs etc.
                const activeElement = document.activeElement;
                const isGridFocused = gridElement.contains(activeElement) && activeElement.tagName !== 'INPUT' && activeElement.tagName !== 'TEXTAREA';

                if (isGridFocused) {
                    const csvData = exportSelectedRowsToCsv(currentGridApi);
                    if (csvData) {
                        navigator.clipboard.writeText(csvData)
                            .then(() => {
                                console.log('Selected rows copied to clipboard as CSV with headers.');
                                // Optional: provide feedback to the user e.g. via a temporary message
                                vscode.postMessage({ command: 'showInfo', text: 'Selected rows copied as CSV.' });
                            })
                            .catch(err => {
                                console.error('Failed to copy selected rows to clipboard: ', err);
                                vscode.postMessage({ command: 'showError', text: 'Failed to copy as CSV. See console for details.' });
                            });
                        event.preventDefault(); // Prevent default copy action of AG Grid / browser
                    }
                }
            }
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