const fs = require('fs');
const path = require('path');

const localeDir = path.join(__dirname, '..', 'public', 'locales');

function flattenKeys(value, prefix = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }

  return Object.entries(value).flatMap(([key, child]) => {
    const childPrefix = prefix ? `${prefix}.${key}` : key;
    return child && typeof child === 'object' && !Array.isArray(child)
      ? flattenKeys(child, childPrefix)
      : [childPrefix];
  });
}

function findLocaleJsonFiles(rootDir) {
  if (!fs.existsSync(rootDir)) return [];
  const files = [];
  const walk = currentDir => {
    fs.readdirSync(currentDir, { withFileTypes: true }).forEach(entry => {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.name.endsWith('.json') && fullPath.includes(`${path.sep}locales${path.sep}`)) {
        files.push(fullPath);
      }
    });
  };
  walk(rootDir);
  return files;
}

describe('locale assets', () => {
  const localeFiles = fs.readdirSync(localeDir)
    .filter(name => name.endsWith('.json'))
    .sort();

  test('ships at least the Korean locale', () => {
    expect(localeFiles).toContain('ko.json');
  });

  test.each(localeFiles)('%s is valid JSON with string leaf values', fileName => {
    const raw = fs.readFileSync(path.join(localeDir, fileName), 'utf8');
    const parsed = JSON.parse(raw);
    const keys = flattenKeys(parsed);

    expect(parsed).toBeTruthy();
    expect(keys.length).toBeGreaterThan(0);
    keys.forEach(key => {
      const value = key.split('.').reduce((current, part) => current[part], parsed);
      expect(typeof value).toBe('string');
    });
  });

  test('every static HTML translation key exists in the Korean locale', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const korean = JSON.parse(fs.readFileSync(path.join(localeDir, 'ko.json'), 'utf8'));
    const koreanKeys = new Set(flattenKeys(korean));
    const referencedKeys = Array.from(html.matchAll(
      /data-i18n(?:-title|-placeholder)?=["']([^"']+)["']/g
    )).map(match => match[1]);

    expect(referencedKeys.length).toBeGreaterThan(0);
    referencedKeys.forEach(key => expect(koreanKeys).toContain(key));
  });

  test('all checked-in distribution locale assets remain valid JSON', () => {
    const distributionLocales = findLocaleJsonFiles(path.join(__dirname, '..', 'dist'));

    expect(distributionLocales.length).toBeGreaterThan(0);
    distributionLocales.forEach(filePath => {
      expect(() => JSON.parse(fs.readFileSync(filePath, 'utf8'))).not.toThrow();
    });
  });
});
