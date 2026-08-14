const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const style = fs.readFileSync(path.join(root, 'public', 'css', 'style.css'), 'utf8');
const canStyle = fs.readFileSync(path.join(root, 'public', 'css', 'can-diagnostics.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'js', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');

describe('Resolution-adaptive layout contract', () => {
  test('uses a flexible viewport-height workspace instead of a fixed header offset', () => {
    expect(style).toContain('--easyloop-viewport-height: 100dvh');
    expect(style).toMatch(/#main-content\s*\{[\s\S]*?flex-direction:\s*column/);
    expect(style).toMatch(/#main-layout\s*\{[\s\S]*?flex:\s*1 1 auto/);
    expect(app).toContain("mainContent.style.display = 'flex'");
  });

  test('defines laptop, tablet, mobile and short-screen adaptations', () => {
    expect(style).toContain('@media (max-width: 1480px)');
    expect(style).toContain('@media (max-width: 1180px)');
    expect(style).toContain('@media (max-width: 980px)');
    expect(style).toContain('@media (max-width: 620px)');
    expect(style).toContain('@media (max-height: 760px) and (min-width: 981px)');
    expect(style).toContain('@media (pointer: coarse)');
  });

  test('keeps specialized CAN diagnostics and compact map controls responsive', () => {
    expect(canStyle).toContain('@media (max-width: 980px)');
    expect(canStyle).toContain('@media (max-width: 620px)');
    expect(app).toContain("btn.title = '지도 패널 표시/숨김'");
    expect(html).toContain('css/style.css?v=20260806-stl-ulsan-jog');
    expect(html).toContain('js/app.js?v=20260731-manual-on-robot-switch');
  });

  test('keeps the global Quick Task entry prominent and full-width on mobile', () => {
    expect(html).toContain('id="btn-global-quick-task"');
    expect(style).toMatch(/\.header-primary-quick-task\s*\{[\s\S]*?min-width:\s*184px/);
    expect(style).toMatch(
      /@media \(max-width: 620px\)\s*\{[\s\S]*?\.header-primary-quick-task\s*\{[\s\S]*?width:\s*100%/
    );
    expect(style).toMatch(/\.quick-task-run-primary\s*\{[\s\S]*?min-height:\s*74px/);
  });
});
