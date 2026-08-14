const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const jsDir = path.join(root, 'public/js');
const browserSource = fs.readdirSync(jsDir)
  .filter(file => file.endsWith('.js'))
  .map(file => fs.readFileSync(path.join(jsDir, file), 'utf8'))
  .join('\n');

describe('button wiring contracts', () => {
  test('every identified static button has a unique id referenced by browser behavior code', () => {
    const ids = Array.from(html.matchAll(/<button\b[^>]*\bid=["']([^"']+)/gi), match => match[1]);
    expect(new Set(ids).size).toBe(ids.length);

    const unreferenced = ids.filter(id => !browserSource.includes(id));
    expect(unreferenced).toEqual([]);
  });

  test('ROS favorites clear button resets, persists, and renders the list', () => {
    const rosInfo = fs.readFileSync(path.join(jsDir, 'ros-info.js'), 'utf8');
    expect(rosInfo).toMatch(/clearFavorites\(\)\s*\{[\s\S]*?this\._favorites\s*=\s*\[\];[\s\S]*?this\.saveFavorites\(\);[\s\S]*?this\.renderFavorites\(\);/);
    expect(rosInfo).toMatch(/getElementById\('btn-ros-fav-clear'\)[\s\S]*?addEventListener\('click',[\s\S]*?RosInfo\.clearFavorites\(\)/);
  });

  test('floating widget header and close button use their actual DOM ids', () => {
    const app = fs.readFileSync(path.join(jsDir, 'app.js'), 'utf8');
    expect(app).toContain("getElementById('floating-widget-header')");
    expect(app).toContain("getElementById('floating-widget-close')");
    expect(app).toMatch(/fwClose\.addEventListener\('click',[\s\S]*?floatingWidget\.classList\.add\('hidden'\)/);
  });

  test('shared robot and toast helpers used by feature buttons exist', () => {
    const app = fs.readFileSync(path.join(jsDir, 'app.js'), 'utf8');
    const canDiagnostics = fs.readFileSync(path.join(jsDir, 'can-diagnostics.js'), 'utf8');
    expect(app).toMatch(/getActiveRobot\(\)\s*\{[\s\S]*?this\.robotSlots\[this\.activeSlotIndex\]/);
    expect(app).toMatch(/showToast\(message,[\s\S]*?return this\.toast\(message, type, duration\);/);
    expect(canDiagnostics).toMatch(/_getRobotIp\(\)\s*\{[\s\S]*?App\.getActiveRobot\(\)/);
    expect(app).toMatch(/logEvent\(event = \{\}\)\s*\{[\s\S]*?return this\.addEvent\(/);
    expect(app).toMatch(/setActiveSlot\(index\)\s*\{[\s\S]*?return this\.switchActiveRobot\(index\);/);
  });

  test('every App method invoked by a browser module exists on the App object', () => {
    const app = fs.readFileSync(path.join(jsDir, 'app.js'), 'utf8');
    const calls = new Set(Array.from(
      browserSource.matchAll(/\bApp\.([A-Za-z_$][\w$]*)\s*\(/g),
      match => match[1]
    ));
    const methods = new Set(Array.from(
      app.matchAll(/^\s{2}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^\n]*\)\s*\{/gm),
      match => match[1]
    ));
    expect(Array.from(calls).filter(name => !methods.has(name))).toEqual([]);
  });
});
