const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'js', 'app.js'), 'utf8');
const rosManager = fs.readFileSync(path.join(root, 'public', 'js', 'ros-manager.js'), 'utf8');
const testMode = fs.readFileSync(path.join(root, 'public', 'js', 'test-mode.js'), 'utf8');
const style = fs.readFileSync(path.join(root, 'public', 'css', 'style.css'), 'utf8');

describe('simplified operator header', () => {
  test('compresses Test Mode into one summary button and a detail popover', () => {
    expect(html).toContain('id="btn-test-mode-menu"');
    expect(html).toContain('id="test-mode-popover"');
    expect(html).toContain('id="test-mode-robot-count"');
    expect(html).toContain('id="btn-test-mode"');
    expect(testMode).toContain("status.textContent = this._starting ? '...' : (this.enabled ? 'ON' : 'OFF')");
    expect(testMode).toContain("toggleButton.textContent = this.enabled ? 'Test Mode 종료'");
  });

  test('keeps only SOC on the surface and moves BMS details one level deeper', () => {
    expect(html).toMatch(/<button id="btn-bms-detail"[\s\S]*?id="bms-gauge-text"/);
    expect(html).toContain('id="bms-detail-modal"');
    expect(html).toContain('id="bms-time-estimate"');
    expect(html).toContain('id="btn-bms-test-charge"');
    expect(app).toContain('setupBmsDetails()');
  });

  test('uses short connection states with details in a popover', () => {
    expect(html).toContain('id="btn-connection-summary"');
    expect(html).toContain('id="connection-popover"');
    expect(app).toContain("shortState = '수신'");
    expect(app).toContain("shortState = '오프'");
    expect(app).toContain("opt.textContent = `${unitLabel} · ${slot.robotId} · ${connLabel}`");
  });

  test('keeps the simplified header responsive', () => {
    expect(style).toContain('Simplified operator header');
    expect(style).toContain('.header-summary-btn');
    expect(style).toContain('.header-quick-popover');
    expect(style).toContain('.hdr-tool-grid');
    expect(style).toMatch(/@media \(max-width: 620px\)[\s\S]*?\.hdr-more-menu/);
  });

  test('uses compact Jog and CMD symbols with hover descriptions', () => {
    expect(html).toMatch(/id="btn-jog-toggle"[\s\S]*?title="Jog 수동 조작 패널 열기\/닫기"/);
    expect(html).toMatch(/id="btn-cmd-toggle"[\s\S]*?title="빠른 명령어 CMD 패널 열기\/닫기"/);
    expect(html).toContain('class="header-tool-glyph jog-glyph"');
    expect(html).toContain('class="header-tool-glyph cmd-glyph"');
    expect(style).toContain('.header-tool-icon-btn');
  });

  test('uses consistent symbols for connection actions and keeps auto reconnect state accessible', () => {
    expect(html).toMatch(/id="btn-robot-scan"[\s\S]*?aria-label="로봇 다시 검색"[\s\S]*?⌕/);
    expect(html).toMatch(/id="btn-auto-reconnect"[\s\S]*?auto-reconnect-symbol[\s\S]*?↻/);
    expect(html).toMatch(/id="btn-robot-manager"[\s\S]*?aria-label="로봇 및 네트워크 상세 설정"[\s\S]*?⚙/);
    expect(rosManager).toContain("btn.setAttribute('aria-pressed', String(enabled))");
    expect(style).toContain('.header-popover-actions .connection-icon-btn');
  });

  test('removes Connection Timeline from the dashboard and connection handlers', () => {
    expect(html).not.toContain('Connection Timeline');
    expect(html).not.toContain('id="conn-timeline-list"');
    expect(html).not.toContain('id="btn-clear-conn-timeline"');
    expect(app).not.toContain('const ConnTimeline');
    expect(rosManager).not.toContain('ConnTimeline.record');
  });

});

describe('header settings tools', () => {
  const toolContracts = [
    ['btn-init-setup', 'init-setup.js', 'InitSetup.init()'],
    ['btn-error-codes', 'error-codes.js', 'ErrorCodeDB.init()'],
    ['btn-health-check', 'health-check.js', 'HealthCheck.init()'],
    ['btn-diagnostic', 'diagnostic-tree.js', 'DiagnosticTree.init()'],
    ['btn-incident-report', 'incident-report.js', 'IncidentReport.init()']
  ];

  test.each(toolContracts)('%s has a loaded idempotent module', (buttonId, fileName, centralInit) => {
    const moduleSource = fs.readFileSync(path.join(root, 'public', 'js', fileName), 'utf8');
    expect(html).toContain(`id="${buttonId}"`);
    expect(moduleSource).toContain('if (this._initialized) return;');
    expect(app).toContain(centralInit);
  });

  test('internal log, alarm, audit and backup tools retain handlers', () => {
    [
      'btn-alarm-settings',
      'btn-event-log',
      'btn-audit-trail',
      'btn-session-export',
      'btn-session-import'
    ].forEach(id => expect(html).toContain(`id="${id}"`));
    expect(app).toContain("document.getElementById('btn-alarm-settings')");
    expect(app).toContain("document.getElementById('btn-event-log')");
    expect(app).toContain("document.getElementById('btn-audit-trail')");
    expect(app).toContain("document.getElementById('btn-session-export').addEventListener");
    expect(app).toContain("document.getElementById('btn-session-import').addEventListener");
  });

  test('supports both modal visibility conventions used by header tools', () => {
    expect(style).toMatch(/\.modal\.show,\s*\n\.modal\.active\s*\{\s*\n\s*display:\s*flex/);
  });
});
