const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(publicDir, 'css', 'hig.css'), 'utf8');
const source = fs.readFileSync(path.join(publicDir, 'js', 'action-sender.js'), 'utf8');

describe('Quick Task HIG workspace', () => {
  test('separates route authoring, auxiliary actions, settings, and result views', () => {
    [
      'quick-task-primary-row',
      'quick-task-onboarding',
      'quick-task-workspace',
      'quick-task-path-card',
      'quick-task-terminal-card',
      'quick-task-results-grid',
      'quick-task-sequence-card'
    ].forEach(className => {
      expect(html).toMatch(new RegExp(`class="[^"]*\\b${className}\\b`));
    });

    expect(html).toContain('id="quick-task-path-title">경로 입력');
    expect(html).toContain('id="quick-task-terminal-title">보조 Action');
    expect(html).toContain('id="quick-action-preview-title">ROS Action 미리보기');
    expect(html).toContain('id="quick-task-sequence-title">작성 순서');
  });

  test('shows one DockingOut append control while retaining the legacy event hook', () => {
    expect((html.match(/id="btn-quick-docking-out"/g) || [])).toHaveLength(1);
    expect((html.match(/id="btn-quick-docking-out-inline"/g) || [])).toHaveLength(1);
    expect(html).toMatch(
      /id="btn-quick-docking-out-inline" hidden aria-hidden="true" tabindex="-1"/
    );
    expect(source).toContain("['btn-quick-docking-out', 'btn-quick-docking-out-inline']");
  });

  test('keeps every existing Quick Task behavior target wired', () => {
    [
      'btn-run-quick-task',
      'btn-quick-waypoint',
      'btn-quick-trajectory',
      'btn-quick-freehand',
      'btn-quick-trajectory-finish',
      'btn-quick-docking',
      'btn-quick-docking-inline',
      'btn-quick-docking-out',
      'btn-quick-docking-out-map',
      'btn-quick-standby',
      'btn-quick-task-undo',
      'btn-quick-task-clear'
    ].forEach(id => {
      expect((html.match(new RegExp(`id="${id}"`, 'g')) || [])).toHaveLength(1);
      expect(source).toContain(`'${id}'`);
    });
  });

  test('uses balanced responsive grids and non-overlapping shortcut badges', () => {
    expect(css).toMatch(
      /\.quick-task-workspace\s*\{[\s\S]*?grid-template-columns:\s*repeat\(auto-fit, minmax\(330px, 1fr\)\);/
    );
    expect(css).toMatch(
      /\.quick-task-results-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(auto-fit, minmax\(320px, 1fr\)\);/
    );
    expect(css).toMatch(
      /\.quick-task-tools \.btn\[data-shortcut\]::after,[\s\S]*?position:\s*static;[\s\S]*?margin-left:\s*auto;[\s\S]*?transform:\s*none;/
    );
    expect(css).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.quick-task-primary-row,[\s\S]*?\.quick-task-results-grid\s*\{\s*grid-template-columns:\s*1fr;/
    );
  });
});
