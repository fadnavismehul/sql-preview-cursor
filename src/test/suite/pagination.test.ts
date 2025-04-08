import * as vscode from 'vscode';
import axios from 'axios';
import { mockContext, mockWorkspaceConfig } from '../setup';
import { activate } from '../../extension';

// Mock the entire trino-client module
jest.mock('trino-client', () => ({
    Client: jest.fn()
}));

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Pagination Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Mock configuration
        mockWorkspaceConfig.get.mockImplementation((key: string) => {
            switch(key) {
                case 'maxRowsToDisplay': return 100;
                case 'host': return 'localhost';
                case 'port': return 8080;
                case 'user': return 'test';
                case 'ssl': return false;
                case 'sslVerify': return true;
                default: return '';
            }
        });
    });

    test('should fetch multiple pages until maxRowsToDisplay is reached', async () => {
        // Mock initial query response
        const mockQueryResponse = {
            id: 'query_123',
            columns: [{ name: 'col1', type: 'varchar' }],
            data: Array(50).fill({ col1: 'value' }),
            nextUri: 'http://localhost:8080/v1/query/123/1',
        };

        // Mock subsequent pages
        mockedAxios.get
            .mockResolvedValueOnce({
                data: {
                    data: Array(50).fill({ col1: 'value2' }),
                    nextUri: 'http://localhost:8080/v1/query/123/2',
                }
            } as any)
            .mockResolvedValueOnce({
                data: {
                    data: Array(50).fill({ col1: 'value3' }),
                    nextUri: null, // Last page
                }
            } as any);

        // Setup trino-client mock
        const mockTrinoClient = {
            query: jest.fn().mockReturnValue({
                next: jest.fn().mockResolvedValue(mockQueryResponse)
            })
        };
        jest.requireMock('trino-client').Client.mockImplementation(() => mockTrinoClient);

        // Activate extension
        const context = mockContext as unknown as vscode.ExtensionContext;
        await activate(context);

        // Trigger query execution
        const command = vscode.commands.executeCommand('presto.runCursorQuery', 'SELECT * FROM test_table');
        
        // Wait for async operations
        await new Promise(resolve => setTimeout(resolve, 100));

        // Verify initial query was made
        expect(mockTrinoClient.query).toHaveBeenCalled();

        // Verify subsequent pages were fetched
        expect(mockedAxios.get).toHaveBeenCalledTimes(2);
        expect(mockedAxios.get).toHaveBeenCalledWith(
            'http://localhost:8080/v1/query/123/1',
            expect.any(Object)
        );
        expect(mockedAxios.get).toHaveBeenCalledWith(
            'http://localhost:8080/v1/query/123/2',
            expect.any(Object)
        );
    });

    test('should stop fetching when maxRowsToDisplay is reached', async () => {
        // Mock maxRowsToDisplay = 75
        mockWorkspaceConfig.get.mockImplementation((key: string) => 
            key === 'maxRowsToDisplay' ? 75 : mockWorkspaceConfig.get(key)
        );

        // Mock initial query response (50 rows)
        const mockQueryResponse = {
            id: 'query_123',
            columns: [{ name: 'col1', type: 'varchar' }],
            data: Array(50).fill({ col1: 'value' }),
            nextUri: 'http://localhost:8080/v1/query/123/1',
        };

        // Mock page 2 (50 rows, but we should only take 25)
        mockedAxios.get.mockResolvedValueOnce({
            data: {
                data: Array(50).fill({ col1: 'value2' }),
                nextUri: 'http://localhost:8080/v1/query/123/2', // We shouldn't reach this
            }
        } as any);

        // Setup mocks
        const mockTrinoClient = {
            query: jest.fn().mockReturnValue({
                next: jest.fn().mockResolvedValue(mockQueryResponse)
            })
        };
        jest.requireMock('trino-client').Client.mockImplementation(() => mockTrinoClient);

        // Activate extension
        const context = mockContext as unknown as vscode.ExtensionContext;
        await activate(context);

        // Trigger query execution
        const command = vscode.commands.executeCommand('presto.runCursorQuery', 'SELECT * FROM test_table');
        
        // Wait for async operations
        await new Promise(resolve => setTimeout(resolve, 100));

        // Verify we only fetched one additional page
        expect(mockedAxios.get).toHaveBeenCalledTimes(1);
        expect(mockedAxios.get).toHaveBeenCalledWith(
            'http://localhost:8080/v1/query/123/1',
            expect.any(Object)
        );
    });

    test('should handle pagination errors gracefully', async () => {
        // Mock initial successful query
        const mockQueryResponse = {
            id: 'query_123',
            columns: [{ name: 'col1', type: 'varchar' }],
            data: Array(50).fill({ col1: 'value' }),
            nextUri: 'http://localhost:8080/v1/query/123/1',
        };

        // Setup mocks
        const mockTrinoClient = {
            query: jest.fn().mockReturnValue({
                next: jest.fn().mockResolvedValue(mockQueryResponse)
            })
        };
        jest.requireMock('trino-client').Client.mockImplementation(() => mockTrinoClient);

        // Mock axios to fail on pagination request
        mockedAxios.get.mockRejectedValueOnce(new Error('Network error'));

        // Spy on vscode.window.showWarningMessage
        const showWarningMessage = jest.spyOn(vscode.window, 'showWarningMessage');

        // Activate extension
        const context = mockContext as unknown as vscode.ExtensionContext;
        await activate(context);

        // Trigger query execution
        const command = vscode.commands.executeCommand('presto.runCursorQuery', 'SELECT * FROM test_table');
        
        // Wait for async operations
        await new Promise(resolve => setTimeout(resolve, 100));

        // Verify error handling
        expect(showWarningMessage).toHaveBeenCalledWith(
            expect.stringContaining('Failed to fetch all results page 2')
        );

        // Verify we don't try to fetch more pages after error
        expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });
}); 