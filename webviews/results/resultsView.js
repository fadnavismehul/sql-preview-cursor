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
    const tabList = document.getElementById('tab-list');
    const tabContentContainer = document.getElementById('tab-content-container');
    const noTabsMessage = document.getElementById('no-tabs-message');
    const newTabButton = document.getElementById('new-tab-button');

    // --- Tab Management State --- 
    let tabs = []; // Array of tab objects
    let activeTabId = null;
    let nextTabId = 1;

    // --- Tab Management Functions ---
    function createTab(query, title, providedTabId) {
        const tabId = providedTabId || `tab-${nextTabId++}`;
        const shortQuery = query.length > 50 ? query.substring(0, 50) + '...' : query;
        const tabTitle = title || `Query ${nextTabId}`;
        
        // Check if tab already exists
        const existingTab = tabs.find(t => t.id === tabId);
        if (existingTab) {
            console.log(`Tab ${tabId} already exists, returning existing tab`);
            return existingTab;
        }
        
        const tab = {
            id: tabId,
            title: tabTitle,
            query: query,
            gridApi: null,
            data: null
        };

        tabs.push(tab);
        
        // Create tab element
        const tabElement = document.createElement('div');
        tabElement.className = 'tab';
        tabElement.setAttribute('data-tab-id', tabId);
        tabElement.innerHTML = `
            <span class="tab-title" title="${query}">${tabTitle}</span>
            <button class="tab-close" title="Close tab">×</button>
        `;
        
        // Create tab content
        const tabContent = document.createElement('div');
        tabContent.className = 'tab-content';
        tabContent.setAttribute('data-tab-id', tabId);
        tabContent.innerHTML = `
            <div class="controls">
                <div>
                    <span class="status-message">Ready</span>
                    <span class="row-count-info"></span>
                    <span class="truncation-warning" style="display: none; color: var(--vscode-descriptionForeground); margin-left: 10px;">(Results limited)</span>
                </div>
                <div>
                    <button class="export-button" style="display: none;" title="Export full results to CSV">Export CSV</button> 
                </div>
            </div>
            <div class="error-container error-message" style="display: none;"></div>
            <div class="loading-indicator loading" style="display: none;">
                <div class="spinner"></div> 
                <span>Loading...</span>
            </div>
            <div class="results-grid ag-theme-quartz"></div>
        `;

        // Add event listeners
        tabElement.addEventListener('click', (e) => {
            if (!e.target.classList.contains('tab-close')) {
                activateTab(tabId);
            }
        });

        tabElement.querySelector('.tab-close').addEventListener('click', (e) => {
            e.stopPropagation();
            closeTab(tabId);
        });

        // Add to DOM
        tabList.appendChild(tabElement);
        tabContentContainer.appendChild(tabContent);
        
        // Hide no-tabs message
        noTabsMessage.style.display = 'none';
        
        // Activate the new tab
        activateTab(tabId);
        
        return tab;
    }

    function activateTab(tabId) {
        // Deactivate all tabs
        document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        
        // Activate selected tab
        const tabElement = document.querySelector(`.tab[data-tab-id="${tabId}"]`);
        const tabContent = document.querySelector(`.tab-content[data-tab-id="${tabId}"]`);
        
        if (tabElement && tabContent) {
            tabElement.classList.add('active');
            tabContent.classList.add('active');
            activeTabId = tabId;
        }
    }

    function closeTab(tabId) {
        const tabIndex = tabs.findIndex(tab => tab.id === tabId);
        if (tabIndex === -1) return;

        const tab = tabs[tabIndex];
        
        // Destroy AG Grid instance if exists
        if (tab.gridApi) {
            try {
                tab.gridApi.destroy();
            } catch(e) { console.warn("Error destroying grid:", e); }
        }
        
        // Remove from DOM
        const tabElement = document.querySelector(`.tab[data-tab-id="${tabId}"]`);
        const tabContent = document.querySelector(`.tab-content[data-tab-id="${tabId}"]`);
        if (tabElement) tabElement.remove();
        if (tabContent) tabContent.remove();
        
        // Remove from tabs array
        tabs.splice(tabIndex, 1);
        
        // If this was the active tab, activate another one
        if (activeTabId === tabId) {
            activeTabId = null;
            if (tabs.length > 0) {
                activateTab(tabs[Math.max(0, tabIndex - 1)].id);
            } else {
                // Show no-tabs message
                noTabsMessage.style.display = 'flex';
            }
        }
    }

    function getActiveTab() {
        return tabs.find(tab => tab.id === activeTabId);
    }

    function getTabElements(tabId) {
        const tabContent = document.querySelector(`.tab-content[data-tab-id="${tabId}"]`);
        if (!tabContent) return null;
        
        return {
            gridElement: tabContent.querySelector('.results-grid'),
            errorContainer: tabContent.querySelector('.error-container'),
            loadingIndicator: tabContent.querySelector('.loading-indicator'),
            statusMessageElement: tabContent.querySelector('.status-message'),
            rowCountInfoElement: tabContent.querySelector('.row-count-info'),
            truncationWarningElement: tabContent.querySelector('.truncation-warning'),
            exportButton: tabContent.querySelector('.export-button')
        };
    }

    // Add event listener for new tab button
    newTabButton.addEventListener('click', () => {
        vscode.postMessage({ command: 'createNewTab' });
    });

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
    function initializeGrid(tabId, columns, data, wasTruncated, totalRowsInFirstBatch) {
        const tab = tabs.find(t => t.id === tabId);
        if (!tab) {
            console.error(`Tab ${tabId} not found!`);
            return;
        }

        const elements = getTabElements(tabId);
        if (!elements || !elements.gridElement) {
            console.error(`Grid element for tab ${tabId} not found!`);
            return;
        }

        // Clear previous grid if exists
        if (tab.gridApi) {
            try {
                tab.gridApi.destroy();
            } catch(e) { console.warn("Error destroying previous grid:", e); }
            tab.gridApi = null;
        }
        // Ensure the grid div is empty before creating a new grid
        elements.gridElement.innerHTML = '';

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
                if (!tab.gridApi) {
                    tab.gridApi = params.api;
                    console.log(`AG Grid: API set via onGridReady for tab ${tabId}.`);
                } else if (tab.gridApi !== params.api) {
                    console.warn(`AG Grid: API from createGrid and onGridReady mismatch for tab ${tabId}.`);
                    tab.gridApi = params.api;
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
                console.log("Current Grid API:", tab.gridApi);
                console.log("--- End AG Grid Theme Debug ---");
                // --- End Debug Logging ---

                console.log(`AG Grid: Grid is ready for tab ${tabId}.`);
                console.log("AG Grid: Configured icons:", gridOptions.icons); // Log defined icons
                
                // Auto-size columns to fit content, including headers
                // Use timeout to ensure all data is rendered before sizing
                setTimeout(() => {
                    params.api.autoSizeAllColumns();
                }, 100);

                // Add keydown listener for custom CSV copy
                if (elements.gridElement && tab.gridApi) {
                    elements.gridElement.removeEventListener('keydown', handleGridKeyDown); // Remove previous if any
                    elements.gridElement.addEventListener('keydown', (event) => handleGridKeyDown(event, tabId));
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
        if (elements.gridElement) {
            tab.gridApi = agGrid.createGrid(elements.gridElement, gridOptions);
            console.log(`AG Grid: Instance created via createGrid for tab ${tabId}.`);
        } else {
            console.error(`AG Grid target element not found when creating grid for tab ${tabId}.`);
        }
        
        // Store tab data
        tab.data = { columns, rows: data, wasTruncated, totalRowsInFirstBatch };
        
        updateRowCount(tabId, data.length, totalRowsInFirstBatch, wasTruncated);

        if (elements.exportButton) {
             elements.exportButton.style.display = (totalRowsInFirstBatch > 0) ? 'inline-block' : 'none';
             elements.exportButton.onclick = () => {
                if (tab.gridApi) {
                    tab.gridApi.exportDataAsCsv();
                } else {
                    vscode.postMessage({ command: 'alert', text: 'Grid not available for export.' });
                }
            };
        }
    }

    // --- Grid Keydown Handler for Custom Copy ---
    function handleGridKeyDown(event, tabId) {
        const tab = tabs.find(t => t.id === tabId);
        if (!tab || !tab.gridApi) return;

        // Check for Ctrl+C (Windows/Linux) or Cmd+C (Mac)
        if ((event.ctrlKey || event.metaKey) && event.key === 'c') {
            if (tab.gridApi.getSelectedNodes().length > 0) {
                // Check if the focused element is part of the grid or an input inside the grid
                // This helps avoid overriding copy from filter inputs etc.
                const activeElement = document.activeElement;
                const elements = getTabElements(tabId);
                const isGridFocused = elements && elements.gridElement.contains(activeElement) && activeElement.tagName !== 'INPUT' && activeElement.tagName !== 'TEXTAREA';

                if (isGridFocused) {
                    const csvData = exportSelectedRowsToCsv(tab.gridApi);
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
    function updateRowCount(tabId, displayedCount, totalInBatch, wasTruncated) {
        const elements = getTabElements(tabId);
        if (!elements) return;
        
        if (elements.rowCountInfoElement) {
            let text = `(${displayedCount} row${displayedCount !== 1 ? 's' : ''} shown`;
            if (wasTruncated) {
                 text += ` of ${totalInBatch} (first batch)`;
            }
            text += ')';
            elements.rowCountInfoElement.textContent = text;
        }
        if (elements.truncationWarningElement) {
             elements.truncationWarningElement.style.display = wasTruncated ? 'inline' : 'none';
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

        // Handle tab-specific operations
        let currentTab = null;
        let elements = null;
        
        if (message.tabId) {
            currentTab = tabs.find(t => t.id === message.tabId);
            elements = getTabElements(message.tabId);
        } else if (activeTabId) {
            currentTab = getActiveTab();
            elements = getTabElements(activeTabId);
        }

        // Clear loading/error states for the current tab
        if (elements) {
            if (elements.loadingIndicator) elements.loadingIndicator.style.display = 'none';
            
            if (message.type !== 'showLoading' && elements.errorContainer) {
                elements.errorContainer.textContent = '';
                elements.errorContainer.style.display = 'none';
            }
            if (message.type !== 'showLoading' && elements.statusMessageElement) {
                 if (message.type !== 'statusMessage') {
                     elements.statusMessageElement.textContent = 'Finished'; 
                 }
            }
            if (message.type !== 'showLoading' && elements.rowCountInfoElement) {
                 if (message.type !== 'resultData') {
                      elements.rowCountInfoElement.textContent = ''; 
                      if (elements.truncationWarningElement) elements.truncationWarningElement.style.display = 'none';
                      if (elements.exportButton) elements.exportButton.style.display = 'none';
                 }
            }
        }

        switch (message.type) {
            case 'createTab':
                console.log("Received createTab message", message);
                const tab = createTab(message.query || 'New Query', message.title, message.tabId);
                // Auto-show loading for the new tab
                const newElements = getTabElements(tab.id);
                if (newElements) {
                    if (newElements.loadingIndicator) newElements.loadingIndicator.style.display = 'flex';
                    if (newElements.statusMessageElement) newElements.statusMessageElement.textContent = 'Executing query...';
                }
                break;

            case 'showLoading':
                console.log("Received showLoading message", message);
                
                // Find or create the tab with the specific ID
                if (message.tabId) {
                    currentTab = tabs.find(t => t.id === message.tabId);
                    if (!currentTab) {
                        // Create tab with the specific ID if it doesn't exist
                        currentTab = createTab(message.query || 'New Query', message.title, message.tabId);
                    }
                    elements = getTabElements(currentTab.id);
                } else if (!elements || !currentTab) {
                    // Fallback: create a new tab without specific ID
                    currentTab = createTab(message.query || 'New Query', message.title);
                    elements = getTabElements(currentTab.id);
                }
                
                if (currentTab && currentTab.gridApi) currentTab.gridApi.setGridOption('rowData', []); // Clear data
                if (elements) {
                    if (elements.loadingIndicator) elements.loadingIndicator.style.display = 'flex';
                    if (elements.statusMessageElement) elements.statusMessageElement.textContent = 'Executing query...';
                    if (elements.rowCountInfoElement) elements.rowCountInfoElement.textContent = '';
                    if (elements.errorContainer) elements.errorContainer.style.display = 'none';
                    if (currentTab && currentTab.gridApi) currentTab.gridApi.showLoadingOverlay();
                }
                break;

            case 'resultData':
                console.log(`Received resultData: ${message.data?.rows?.length} rows shown`);
                console.log(`Truncated: ${message.data.wasTruncated}, Total in batch: ${message.data.totalRowsInFirstBatch}`);
                console.log(`TabId: ${message.tabId}`);
                
                // Find or create the tab with the specific ID
                if (message.tabId) {
                    currentTab = tabs.find(t => t.id === message.tabId);
                    if (!currentTab) {
                        // Create tab with the specific ID if it doesn't exist
                        currentTab = createTab(message.data.query || 'New Query', message.title, message.tabId);
                    }
                    elements = getTabElements(currentTab.id);
                } else if (!currentTab) {
                    // Fallback: create a new tab without specific ID
                    currentTab = createTab(message.data.query || 'New Query', message.title);
                    elements = getTabElements(currentTab.id);
                }
                
                if (!currentTab || !elements) {
                    console.error("No tab available for result data", { currentTab, elements, tabId: message.tabId });
                    break;
                }
                
                try {
                    if (currentTab.gridApi) currentTab.gridApi.hideOverlay(); // Hide loading overlay
                    initializeGrid(
                        currentTab.id,
                        message.data.columns, 
                        message.data.rows, 
                        message.data.wasTruncated, 
                        message.data.totalRowsInFirstBatch
                    );
                    if (elements.statusMessageElement) elements.statusMessageElement.textContent = 'Finished';
                    if (elements.errorContainer) elements.errorContainer.style.display = 'none';
                } catch (e) {
                    console.error("Error initializing grid:", e);
                    if (currentTab.gridApi) currentTab.gridApi.hideOverlay();
                    if (elements.errorContainer) {
                        elements.errorContainer.textContent = `Error displaying results: ${e.message}`;
                        elements.errorContainer.style.display = 'block';
                    }
                    if (elements.statusMessageElement) elements.statusMessageElement.textContent = 'Error';
                }
                break;

            case 'queryError':
                console.error("Received queryError:", message.error);
                
                // Find or create the tab with the specific ID
                if (message.tabId) {
                    currentTab = tabs.find(t => t.id === message.tabId);
                    if (!currentTab) {
                        // Create tab with the specific ID if it doesn't exist
                        currentTab = createTab(message.query || 'Failed Query', message.title, message.tabId);
                    }
                    elements = getTabElements(currentTab.id);
                } else if (!elements && !currentTab) {
                    // Fallback: create a tab for the error if none exists
                    currentTab = createTab(message.query || 'Failed Query', message.title);
                    elements = getTabElements(currentTab.id);
                }
                if (currentTab && currentTab.gridApi) {
                    currentTab.gridApi.setGridOption('rowData', []);
                    currentTab.gridApi.hideOverlay();
                }
                if (elements) {
                    if (elements.errorContainer) {
                        elements.errorContainer.textContent = `Query Error: ${message.error.message}`;
                        if (message.error.details) {
                             console.error("Error Details:", message.error.details);
                        }
                        elements.errorContainer.style.display = 'block';
                    }
                    if (elements.statusMessageElement) elements.statusMessageElement.textContent = 'Error';
                    if (elements.rowCountInfoElement) elements.rowCountInfoElement.textContent = '';
                    if (elements.truncationWarningElement) elements.truncationWarningElement.style.display = 'none';
                    if (elements.exportButton) elements.exportButton.style.display = 'none';
                }
                break;
                
            case 'statusMessage':
                console.log("Received statusMessage:", message.message);
                if (currentTab && currentTab.gridApi) {
                    currentTab.gridApi.setGridOption('rowData', []);
                    // Potentially show a specific overlay for status messages if desired
                    // currentTab.gridApi.showNoRowsOverlay(); 
                }
                if (elements) {
                    if (elements.statusMessageElement) elements.statusMessageElement.textContent = message.message;
                    if (elements.rowCountInfoElement) elements.rowCountInfoElement.textContent = '';
                    if (elements.truncationWarningElement) elements.truncationWarningElement.style.display = 'none';
                    if (elements.exportButton) elements.exportButton.style.display = 'none';
                    if (elements.errorContainer) elements.errorContainer.style.display = 'none';
                }
                break;
        }
    });

    console.log("AG Grid results view script loaded and ready.");
} 