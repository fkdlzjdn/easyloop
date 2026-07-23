// Launcher wrapper — starts server and opens browser automatically
const { exec } = require('child_process');
const path = require('path');
const os = require('os');

// Start the actual server and open the browser on the port it selected.
const { serverReady } = require('./server.js');

serverReady.then((port) => {
  const url = `http://localhost:${port}`;
  const platform = os.platform();

  setTimeout(() => {
    console.log(`\n  Opening browser: ${url}\n`);

    if (platform === 'win32') {
      exec(`cmd /c start "" ${url}`);
    } else if (platform === 'darwin') {
      exec(`open ${url}`);
    } else {
      exec(`xdg-open ${url} 2>/dev/null || sensible-browser ${url}`);
    }
  }, 500);
}).catch(() => {
  // server.js already printed the startup error.
});
