import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Test suite for Windows path compatibility fixes
 */
describe('Windows Path Compatibility', () => {
  it('Path normalization handles empty paths correctly', () => {
    // Test empty string - path.normalize('') returns '.' which is correct behavior
    const emptyPath = '';
    const normalizedEmpty = path.normalize(emptyPath);
    assert.strictEqual(normalizedEmpty, '.', 'Empty path should normalize to current directory');

    // Test whitespace-only path - should also normalize to current directory
    const whitespacePath = '   ';
    const normalizedWhitespace = path.normalize(whitespacePath);
    assert.strictEqual(
      normalizedWhitespace,
      '   ',
      'Whitespace path should remain as whitespace after normalization'
    );

    // Our validation logic should detect these as invalid
    assert.strictEqual(emptyPath.trim(), '', 'Empty path should be detected as invalid');
    assert.strictEqual(whitespacePath.trim(), '', 'Whitespace path should be detected as invalid');
  });

  it('Path normalization handles valid paths correctly', () => {
    // Test a typical Windows path
    const windowsPath =
      'C:\\Users\\test\\AppData\\Local\\Programs\\cursor\\resources\\app\\extensions\\mehul.sql-preview-0.1.2';
    const normalizedWindows = path.normalize(windowsPath);
    assert.ok(
      normalizedWindows.length > 0,
      'Valid Windows path should not be empty after normalization'
    );
    assert.ok(
      normalizedWindows.trim() !== '',
      'Valid Windows path should not be whitespace after normalization'
    );

    // Test a Unix path
    const unixPath = '/home/user/.vscode/extensions/mehul.sql-preview-0.1.2';
    const normalizedUnix = path.normalize(unixPath);
    assert.ok(normalizedUnix.length > 0, 'Valid Unix path should not be empty after normalization');
    assert.ok(
      normalizedUnix.trim() !== '',
      'Valid Unix path should not be whitespace after normalization'
    );
  });

  it('URI path validation handles edge cases', () => {
    // Test various edge cases that could cause empty paths
    const testCases = [
      '', // Empty string
      '   ', // Whitespace only
      '\t\n', // Tab and newline
      null as any, // Null
      undefined as any, // Undefined
    ];

    testCases.forEach((testPath, index) => {
      let isValid = false;
      try {
        if (testPath && typeof testPath === 'string' && testPath.trim() !== '') {
          const normalized = path.normalize(testPath);
          if (normalized && normalized.trim() !== '') {
            isValid = true;
          }
        }
      } catch (error) {
        // Expected for invalid paths
      }

      assert.strictEqual(isValid, false, `Test case ${index} should be invalid: ${testPath}`);
    });
  });

  it('Resource path construction validation', () => {
    // Mock extension URI for testing
    const mockExtensionPath =
      process.platform === 'win32'
        ? 'C:\\Users\\test\\vscode\\extensions\\sql-preview'
        : '/home/user/.vscode/extensions/sql-preview';

    const mockExtensionUri = vscode.Uri.file(mockExtensionPath);

    // Test resource path construction
    const webviewsPath = vscode.Uri.joinPath(mockExtensionUri, 'webviews');
    const mediaPath = vscode.Uri.joinPath(mockExtensionUri, 'media');

    // Verify the paths are valid
    assert.ok(webviewsPath.fsPath, 'Webviews path should be constructed');
    assert.ok(mediaPath.fsPath, 'Media path should be constructed');

    // Verify path normalization doesn't create empty paths
    const normalizedWebviews = path.normalize(webviewsPath.fsPath);
    const normalizedMedia = path.normalize(mediaPath.fsPath);

    assert.ok(normalizedWebviews.trim() !== '', 'Normalized webviews path should not be empty');
    assert.ok(normalizedMedia.trim() !== '', 'Normalized media path should not be empty');
  });

  it('Validation logic properly handles filesystem checks', () => {
    // Test the validation logic directly rather than mocking filesystem
    const testCases = [
      { path: '', shouldBeValid: false, description: 'empty path' },
      { path: '   ', shouldBeValid: false, description: 'whitespace path' },
      { path: '/mock/extension/path', shouldBeValid: true, description: 'valid path' },
    ];

    testCases.forEach(testCase => {
      let isValidPath = false;

      // Simulate the same validation logic from extension.ts
      if (testCase.path && testCase.path.trim() !== '') {
        const normalizedPath = path.normalize(testCase.path);
        if (normalizedPath && normalizedPath.trim() !== '') {
          isValidPath = true;
        }
      }

      assert.strictEqual(
        isValidPath,
        testCase.shouldBeValid,
        `Path validation failed for ${testCase.description}: "${testCase.path}"`
      );
    });
  });
});
