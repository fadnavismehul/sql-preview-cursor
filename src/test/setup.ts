import * as vscode from 'vscode';
import { EventEmitter } from 'events';

// Mock VS Code API
const mockWebviewPanel = {
    webview: {
        html: '',
        postMessage: jest.fn(),
        onDidReceiveMessage: jest.fn()
    },
    onDidDispose: jest.fn(),
    reveal: jest.fn(),
    dispose: jest.fn()
};

const mockWorkspaceConfig = {
    get: jest.fn(),
    update: jest.fn(),
    has: jest.fn()
};

const mockContext = {
    subscriptions: [],
    workspaceState: {
        get: jest.fn(),
        update: jest.fn()
    },
    globalState: {
        get: jest.fn(),
        update: jest.fn()
    },
    extensionPath: '/mock/extension/path',
    asAbsolutePath: (relativePath: string) => `/mock/extension/path/${relativePath}`
};

// Mock VS Code namespace
jest.mock('vscode', () => ({
    window: {
        createWebviewPanel: jest.fn(() => mockWebviewPanel),
        showInformationMessage: jest.fn(),
        showErrorMessage: jest.fn(),
        showWarningMessage: jest.fn(),
        createOutputChannel: jest.fn(() => ({
            appendLine: jest.fn(),
            show: jest.fn(),
            clear: jest.fn(),
            dispose: jest.fn()
        }))
    },
    workspace: {
        getConfiguration: jest.fn(() => mockWorkspaceConfig),
        workspaceFolders: [],
        onDidChangeConfiguration: jest.fn()
    },
    EventEmitter: EventEmitter,
    Uri: {
        file: jest.fn(path => ({ fsPath: path })),
        parse: jest.fn()
    },
    ViewColumn: {
        One: 1,
        Two: 2
    },
    Position: jest.fn(),
    Range: jest.fn(),
    StatusBarAlignment: {
        Left: 1,
        Right: 2
    },
    ConfigurationTarget: {
        Global: 1,
        Workspace: 2,
        WorkspaceFolder: 3
    }
}));

// Mock trino-client
jest.mock('trino-client', () => ({
    Client: jest.fn().mockImplementation(() => ({
        query: jest.fn(),
        execute: jest.fn()
    }))
}));

// Mock axios
jest.mock('axios', () => ({
    get: jest.fn(),
    post: jest.fn(),
    create: jest.fn()
}));

// Export mocks for use in tests
export {
    mockWebviewPanel,
    mockWorkspaceConfig,
    mockContext
}; 