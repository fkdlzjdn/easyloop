const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');
const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
const fleetControl = fs.readFileSync(path.join(publicDir, 'js', 'fleet-control.js'), 'utf8');
const packageJson = require(path.join(root, 'package.json'));

const assets = [
  ['vendor/roslib/roslib.min.js', 40000],
  ['vendor/xterm/xterm.js', 200000],
  ['vendor/xterm/xterm.css', 4000],
  ['vendor/xterm-addon-fit/xterm-addon-fit.js', 1000],
  ['vendor/xterm-addon-search/xterm-addon-search.js', 10000]
];

describe('closed-network browser dependencies', () => {
  test('loads every runtime dependency from the local server', () => {
    expect(html).not.toMatch(/<(?:script|link)\b[^>]+(?:src|href)=["']https?:\/\//i);
    expect(html).not.toContain('cdn.jsdelivr.net');
    expect(html).not.toContain('fonts.googleapis.com');

    assets.forEach(([relativePath]) => {
      expect(html).toContain(relativePath);
    });
  });

  test.each(assets)('%s is packaged as a non-empty public asset', (relativePath, minimumBytes) => {
    const stat = fs.statSync(path.join(publicDir, relativePath));
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBeGreaterThan(minimumBytes);
  });

  test('does not dereference an undeclared ROSLIB global in map fallback', () => {
    expect(fleetControl).toContain(
      "typeof ROSLIB === 'undefined' || typeof ROSLIB.Service !== 'function'"
    );
    expect(fleetControl).not.toContain('typeof ROSLIB?.');
  });

  test('standalone build applies the pkg asset configuration', () => {
    expect(packageJson.pkg.assets).toContain('public/**/*');
    ['build:win', 'build:linux', 'build:all'].forEach(scriptName => {
      expect(packageJson.scripts[scriptName]).toContain('pkg --config package.json launcher.js');
    });
  });
});
