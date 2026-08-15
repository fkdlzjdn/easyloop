const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(publicDir, 'css', 'hig.css'), 'utf8');

describe('HIG presentation layer', () => {
  test('loads last so it can restyle every existing component without DOM changes', () => {
    const baseIndex = html.indexOf('css/style.css');
    const canIndex = html.indexOf('css/can-diagnostics.css');
    const terminalIndex = html.indexOf('vendor/xterm/xterm.css');
    const higIndex = html.indexOf('css/hig.css');

    expect(baseIndex).toBeGreaterThan(-1);
    expect(higIndex).toBeGreaterThan(baseIndex);
    expect(higIndex).toBeGreaterThan(canIndex);
    expect(higIndex).toBeGreaterThan(terminalIndex);
  });

  test('defines semantic appearance tokens for dark and light modes', () => {
    expect(css).toContain('--hig-blue: #0a84ff');
    expect(css).toContain('--hig-surface: #1c1c1e');
    expect(css).toContain('body.light-mode');
    expect(css).toContain('--hig-blue: #007aff');
    expect(css).toContain('color-scheme: light');
  });

  test('uses one responsive spacing and control-size rhythm across the interface', () => {
    expect(css).toContain('--hig-control-height: 36px');
    expect(css).toContain('--hig-content-gutter: clamp(12px, 1.35vw, 22px)');
    expect(css).toContain('--hig-card-padding: clamp(14px, 1.1vw, 18px)');
    expect(css).toContain('--hig-section-gap: clamp(12px, 1vw, 16px)');
    expect(css).toMatch(/\.panel-section\s*\{[\s\S]*?padding:\s*var\(--hig-card-padding\);[\s\S]*?margin-bottom:\s*var\(--hig-section-gap\);/);
  });

  test('balances sparse cards, button clusters, forms, and data rows', () => {
    expect(css).toMatch(/\.task-library-grid\s*\{[\s\S]*?align-items:\s*start;[\s\S]*?grid-auto-rows:\s*max-content;/);
    expect(css).toMatch(/\.action-buttons,[\s\S]*?\.undo-redo-controls[\s\S]*?flex-wrap:\s*wrap;/);
    expect(css).toMatch(/\.action-input-row,[\s\S]*?\.topic-filter-row[\s\S]*?flex:\s*1 1 160px;/);
    expect(css).toMatch(/\.dashboard-row,[\s\S]*?\.fw-row[\s\S]*?min-height:\s*38px;/);
  });

  test('supports keyboard focus, reduced motion, reduced transparency, and contrast', () => {
    expect(css).toContain(':focus-visible');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('@media (prefers-reduced-transparency: reduce)');
    expect(css).toContain('@media (prefers-contrast: more)');
  });

  test('remains fully offline and does not import remote visual assets', () => {
    expect(css).not.toMatch(/@import\s+/);
    expect(css).not.toMatch(/url\(\s*["']?https?:\/\//i);
  });

  test('keeps the presentation layer free of behavior-affecting visibility rules', () => {
    expect(css).not.toMatch(/pointer-events:\s*none\s*!important/i);
    expect(css).not.toMatch(/display:\s*none\s*!important(?!;\s*\})/i);
  });

  test('keeps header popovers above the map interaction layer', () => {
    expect(css).toMatch(/#header\s*\{[\s\S]*?position:\s*relative;[\s\S]*?z-index:\s*100;/);
    expect(css).toMatch(/@media \(max-width: 980px\)[\s\S]*?\.hdr-group-robot,[\s\S]*?\.header-right\s*\{\s*overflow:\s*visible;/);
    expect(css).toMatch(/\.connection-popover\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?right:\s*6px;[\s\S]*?left:\s*6px;/);
    expect(css).toMatch(/\.test-mode-popover\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?right:\s*6px;[\s\S]*?left:\s*6px;/);
  });

  test('prevents narrow-screen primary button labels from clipping or wrapping into themselves', () => {
    expect(css).toMatch(/\.quick-task-primary-copy strong\s*\{\s*white-space:\s*nowrap;/);
    expect(css).toMatch(/#btn-fleet-sync-active-map\s*\{[\s\S]*?grid-column:\s*1 \/ -1;[\s\S]*?white-space:\s*normal;/);
    expect(css).toMatch(/@media \(max-width: 360px\)[\s\S]*?\.quick-task-primary-icon\s*\{\s*display:\s*none;/);
  });
});
