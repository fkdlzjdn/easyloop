const fs = require('fs');
const path = require('path');

describe('Action history disclosure', () => {
  test('is collapsed by default and keeps history controls inside the disclosure', () => {
    const html = fs.readFileSync(
      path.join(__dirname, '..', 'public', 'index.html'),
      'utf8'
    );
    const history = html.match(
      /<details class="action-history-section"[\s\S]*?<\/details>/
    )?.[0];

    expect(history).toBeDefined();
    expect(history).not.toMatch(/^<details[^>]*\sopen(?:\s|>)/);
    expect(history).toContain('<summary class="action-history-summary">');
    expect(history).toContain('이전 실행 내역 보기');
    expect(history).toContain('id="btn-clear-action-history"');
    expect(history).toContain('id="action-history-list"');
  });
});
