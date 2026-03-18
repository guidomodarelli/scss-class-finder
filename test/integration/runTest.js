/**
 * Runs the VS Code integration test suite against the fixture workspace.
 *
 * @module integration/runTest
 */
const childProcess = require('node:child_process');
const path = require('node:path');
const { downloadAndUnzipVSCode } = require('@vscode/test-electron');

/**
 * Launches the VS Code executable with integration-test arguments in the required order.
 *
 * @param {string} vscodeExecutablePath - Absolute path to the downloaded VS Code executable.
 * @param {string[]} vscodeLaunchArguments - Ordered arguments for the VS Code process.
 * @returns {Promise<void>} Resolves when the VS Code test process exits with code `0`.
 * @throws {Error} When the VS Code process cannot start or exits with a non-zero code.
 */
function runVsCodeIntegrationProcess(vscodeExecutablePath, vscodeLaunchArguments) {
  const launchTarget = resolveVsCodeLaunchTarget(vscodeExecutablePath);

  return new Promise((resolve, reject) => {
    const integrationProcess = childProcess.spawn(launchTarget.command, [
      ...launchTarget.argsPrefix,
      ...vscodeLaunchArguments,
    ], {
      stdio: 'inherit',
    });

    integrationProcess.once('error', (processError) => {
      reject(
        new Error(
          `runVsCodeIntegrationProcess failed to start VS Code command="${launchTarget.command}" executable="${vscodeExecutablePath}"`,
          { cause: processError },
        ),
      );
    });

    integrationProcess.once('exit', (exitCode, signal) => {
      if (exitCode === 0) {
        resolve();
        return;
      }

      const exitDetail = signal ? `signal=${signal}` : `exitCode=${exitCode}`;
      reject(
        new Error(
          `runVsCodeIntegrationProcess failed for workspace="test/integration/fixtures/workspace" with ${exitDetail}`,
        ),
      );
    });
  });
}

/**
 * Resolves the platform-specific command used to launch the downloaded VS Code build.
 *
 * @param {string} vscodeExecutablePath - Absolute path returned by `downloadAndUnzipVSCode`.
 * @returns {{ command: string, argsPrefix: string[] }} The executable command and required prefix arguments.
 * @throws {Error} When the macOS `.app` bundle cannot be derived from the executable path.
 */
function resolveVsCodeLaunchTarget(vscodeExecutablePath) {
  if (process.platform !== 'darwin') {
    return { command: vscodeExecutablePath, argsPrefix: [] };
  }

  const appPathMatch = vscodeExecutablePath.match(/^(.*\.app)(?:\/Contents\/MacOS\/[^/]+)?$/);
  if (!appPathMatch) {
    throw new Error(
      `resolveVsCodeLaunchTarget failed to derive a macOS app bundle from executable="${vscodeExecutablePath}"`,
    );
  }

  return {
    command: 'open',
    argsPrefix: ['-W', '-n', '-a', appPathMatch[1], '--args'],
  };
}

/**
 * Launches the VS Code test runner with the extension test suite and fixture workspace.
 *
 * @returns {Promise<void>} Resolves when the integration test process exits successfully.
 * @throws {Error} When the VS Code test runner cannot launch or exits with a non-zero code.
 */
async function main() {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');
    const extensionTestsPath = path.resolve(__dirname, './suite/index.js');
    const workspacePath = path.resolve(__dirname, './fixtures/workspace');
    const vscodeLaunchArguments = [
      '--no-sandbox',
      '--disable-gpu-sandbox',
      '--disable-updates',
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-workspace-trust',
      `--extensionTestsPath=${extensionTestsPath}`,
      `--extensionDevelopmentPath=${extensionDevelopmentPath}`,
      workspacePath,
      '--disable-extensions',
    ];

    const vscodeExecutablePath = await downloadAndUnzipVSCode();
    await runVsCodeIntegrationProcess(vscodeExecutablePath, vscodeLaunchArguments);
  } catch (caughtError) {
    console.error(
      'Integration test runner failed while launching VS Code for fixture workspace "test/integration/fixtures/workspace".',
    );
    console.error(caughtError);
    process.exit(1);
  }
}

main();
