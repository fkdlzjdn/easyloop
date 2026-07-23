const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function showErrorAndExit(message) {
  console.error(message);
  if (process.platform === 'win32') {
    // Keep the console visible long enough for the user to read the error.
    setTimeout(() => process.exit(1), 5000);
    return;
  }
  process.exit(1);
}

if (process.platform !== 'win32') {
  showErrorAndExit('This launcher is for Windows only.');
}

const exeDir = path.dirname(process.execPath);
const appDir = path.join(exeDir, 'EasyLoop');
const startBat = path.join(appDir, 'START.bat');

if (!fs.existsSync(startBat)) {
  showErrorAndExit(`START.bat not found: ${startBat}`);
}

try {
  const child = spawn(
    'cmd.exe',
    ['/d', '/c', 'start', '', 'cmd.exe', '/k', 'START.bat'],
    {
      cwd: appDir,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }
  );
  child.unref();
  process.exit(0);
} catch (error) {
  showErrorAndExit(`Failed to launch EasyLoop: ${error.message}`);
}
