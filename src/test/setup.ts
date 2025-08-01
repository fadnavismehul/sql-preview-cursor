// import * as vscode from 'vscode'; // Currently unused in this file
import { EventEmitter } from 'events';

// Mock VS Code API
const mockWebviewPanel = {
  webview: {
    html: '',
    postMessage: jest.fn(),
    onDidReceiveMessage: jest.fn(),
    asWebviewUri: jest.fn(uri => uri),
    options: {},
  },
  onDidDispose: jest.fn(),
  reveal: jest.fn(),
  dispose: jest.fn(),
};

const mockWorkspaceConfig = {
  get: jest.fn(),
  update: jest.fn(),
  has: jest.fn(),
};

const mockContext = {
  subscriptions: [],
  workspaceState: {
    get: jest.fn(),
    update: jest.fn(),
  },
  globalState: {
    get: jest.fn(),
    update: jest.fn(),
  },
  secrets: {
    get: jest.fn(),
    store: jest.fn(),
    delete: jest.fn(),
  },
  extensionPath: '/mock/extension/path',
  extensionUri: { fsPath: '/mock/extension/path', path: '/mock/extension/path' },
  asAbsolutePath: (relativePath: string) => `/mock/extension/path/${relativePath}`,
};

// Mock VS Code namespace
jest.mock('vscode', () => ({
  commands: {
    registerCommand: jest.fn(),
    executeCommand: jest.fn(),
  },
  window: {
    createWebviewPanel: jest.fn(() => mockWebviewPanel),
    registerWebviewViewProvider: jest.fn(),
    showInformationMessage: jest.fn(),
    showErrorMessage: jest.fn(),
    showWarningMessage: jest.fn(),
    showInputBox: jest.fn(),
    activeTextEditor: undefined,
    createOutputChannel: jest.fn(() => ({
      appendLine: jest.fn(),
      show: jest.fn(),
      clear: jest.fn(),
      dispose: jest.fn(),
    })),
  },
  languages: {
    registerCodeLensProvider: jest.fn(),
  },
  workspace: {
    getConfiguration: jest.fn(() => mockWorkspaceConfig),
    workspaceFolders: [],
    onDidChangeConfiguration: jest.fn(() => ({ dispose: jest.fn() })),
  },
  EventEmitter: EventEmitter,
  Uri: {
    file: jest.fn(path => ({ fsPath: path, path })),
    parse: jest.fn(),
    joinPath: jest.fn((base, ...paths) => ({
      fsPath: `${base.fsPath}/${paths.join('/')}`,
      path: `${base.path}/${paths.join('/')}`,
    })),
  },
  ViewColumn: {
    One: 1,
    Two: 2,
  },
  Position: jest.fn(),
  Range: jest.fn(),
  StatusBarAlignment: {
    Left: 1,
    Right: 2,
  },
  ConfigurationTarget: {
    Global: 1,
    Workspace: 2,
    WorkspaceFolder: 3,
  },
}));

// Mock trino-client
jest.mock('trino-client', () => ({
  Trino: {
    create: jest.fn(),
  },
  BasicAuth: jest.fn(),
  Client: jest.fn().mockImplementation(() => ({
    query: jest.fn(),
    execute: jest.fn(),
  })),
}));

// Mock axios
jest.mock('axios', () => ({
  get: jest.fn(),
  post: jest.fn(),
  create: jest.fn(),
}));

// Export mocks for use in tests
export { mockWebviewPanel, mockWorkspaceConfig, mockContext };
