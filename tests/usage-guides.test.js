const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'index.html'),
  'utf8'
);
const source = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'usage-guides.js'),
  'utf8'
);
const style = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'css', 'style.css'),
  'utf8'
);

describe('contextual usage guides contract', () => {
  test('provides a dedicated guide for every primary tab', () => {
    const tabIds = Array.from(html.matchAll(/class="tab-content(?: active)?" id="([^"]+)"/g))
      .map(match => match[1]);

    expect(tabIds.length).toBeGreaterThanOrEqual(13);
    tabIds.forEach(id => {
      expect(source).toContain(`'${id}': {`);
    });
  });

  test('attaches click-to-open notes to tabs, panels, and modal pages', () => {
    expect(source).toContain(".tab-content, #panel-map, #jog-panel, #cmd-panel, #event-log-panel, .modal");
    expect(source).toContain("button.className = 'usage-guide-trigger'");
    expect(source).toContain("modal.className = 'modal usage-guide-modal'");
    expect(style).toContain('.usage-guide-trigger');
    expect(style).toContain('.usage-guide-content');
    expect(html).toContain('js/usage-guides.js?v=20260730-slam-dimension-loop');
  });

  test('uses the real light-mode class and explicit high-contrast guide colors', () => {
    expect(html).toContain('css/style.css?v=20260806-stl-ulsan-jog');
    expect(style).not.toContain('[data-theme="dark"] .usage-guide');
    expect(style).toContain('body.light-mode .usage-guide-content');
    expect(style).toMatch(/\.usage-guide-content\s*\{[\s\S]*?color:\s*#e5edf7/);
    expect(style).toMatch(/body\.light-mode \.usage-guide-content\s*\{[\s\S]*?color:\s*#1f2937/);
    expect(style).toMatch(/\.usage-guide-intro\s*\{[\s\S]*?color:\s*#fef9c3/);
    expect(style).toMatch(/body\.light-mode \.usage-guide-intro\s*\{[\s\S]*?color:\s*#422006/);
    expect(style).toContain('body.light-mode .usage-guide-shortcuts kbd');
    expect(style).toMatch(/\.usage-guide-content\s*\{[\s\S]*?text-align:\s*left/);
    expect(style).toContain('.usage-guide-content li + li');
    expect(style).toContain('.usage-guide-shortcuts > div:last-child');
    expect(style).toContain('.usage-guide-sections.single-secondary');
    expect(source).toContain("modal.querySelector('.usage-guide-sections')");
    expect(source).toContain("target.id === 'mapping-save-confirm-modal'");
  });

  test('documents global, Jog, Quick Task, map edit, terminal, and fleet shortcuts', () => {
    [
      'Ctrl+1~9',
      'W/A/S/D/Q/E',
      'Ctrl+Enter',
      'Terminal Ctrl+F',
      '맵 편집 1~5',
      'O / F'
    ].forEach(shortcut => expect(source).toContain(shortcut));
    expect(html).toContain('미니관제: 선택 로봇 Task 미리보기');
    expect(html).toContain('미니관제 Task 확인창 실행 / 취소');
    expect(source).toContain("['Enter', '확인창의 Task 입력']");
    expect(html).toContain('Jog 충전 ON(확인) / OFF(즉시)');
  });
});
