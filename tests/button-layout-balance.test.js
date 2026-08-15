const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'css', 'hig.css'), 'utf8');

describe('Global button layout balance', () => {
  test('loads the cache-busted global button presentation layer', () => {
    expect(html).toContain('css/hig.css?v=20260814-global-button-balance');
  });

  test('gives standard button labels centered breathing room and safe wrapping', () => {
    expect(css).toMatch(
      /\.btn,[\s\S]*?:where\(button:not\([\s\S]*?display:\s*inline-flex;[\s\S]*?align-items:\s*center;[\s\S]*?justify-content:\s*center;[\s\S]*?gap:\s*6px;/
    );
    expect(css).toMatch(
      /\.btn,[\s\S]*?font-size:\s*12\.5px;[\s\S]*?line-height:\s*1\.3;[\s\S]*?text-wrap:\s*balance;[\s\S]*?white-space:\s*normal;[\s\S]*?word-break:\s*keep-all;/
    );
    expect(css).toMatch(/:where\(button\) > :where\(span, strong, small\)\s*\{\s*min-width:\s*0;/);
  });

  test('uses one alignment rhythm across operational action groups', () => {
    expect(css).toMatch(
      /\.action-buttons,[\s\S]*?\.task-yaml-file-actions,[\s\S]*?gap:\s*var\(--hig-space-2\);[\s\S]*?flex-wrap:\s*wrap;[\s\S]*?align-items:\s*center;[\s\S]*?align-content:\s*flex-start;/
    );
    expect(css).toMatch(
      /\.action-buttons,[\s\S]*?\.quick-dock-wizard-actions[\s\S]*?> \.btn\s*\{[\s\S]*?flex:\s*1 1 112px;/
    );
  });

  test('fills repeated command and topic rows without clipping labels', () => {
    expect(css).toMatch(
      /\.command-buttons\s*\{[\s\S]*?grid-template-columns:\s*repeat\(auto-fit, minmax\(132px, 1fr\)\);/
    );
    expect(css).toMatch(
      /\.cmd-buttons-grid \.cmd-btn\s*\{[\s\S]*?overflow:\s*visible;[\s\S]*?white-space:\s*normal;/
    );
    expect(css).toMatch(
      /\.topic-quick-group\s*\{[\s\S]*?grid-template-columns:\s*52px repeat\(auto-fit, minmax\(104px, 1fr\)\);/
    );
  });

  test('does not introduce duplicate button ids while changing presentation', () => {
    const buttonIds = [...html.matchAll(/<button\b[^>]*\bid="([^"]+)"/g)].map(match => match[1]);
    expect(buttonIds.length).toBeGreaterThan(250);
    expect(new Set(buttonIds).size).toBe(buttonIds.length);
  });
});
