const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeClassList(initial = []) {
  const values = new Set(initial);
  return {
    add: jest.fn(name => values.add(name)),
    remove: jest.fn(name => values.delete(name)),
    toggle: jest.fn((name, enabled) => {
      if (enabled) values.add(name);
      else values.delete(name);
    }),
    contains: name => values.has(name)
  };
}

function makeElement(id, initialClasses = []) {
  const listeners = {};
  return {
    id,
    dataset: {},
    textContent: '',
    title: '',
    classList: makeClassList(initialClasses),
    addEventListener: jest.fn((type, callback) => { listeners[type] = callback; }),
    setAttribute: jest.fn(),
    click: () => listeners.click?.()
  };
}

function loadSetupTabs() {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'app.js'),
    'utf8'
  );
  const methodMatch = source.match(
    /  setupTabs\(\) \{([\s\S]*?)\n  \},\n\n\n  setupMobileSidebar\(\) \{/
  );
  if (!methodMatch) throw new Error('App.setupTabs method not found');

  const dashboardTab = makeElement('dashboard-tab', ['active']);
  dashboardTab.dataset.tab = 'tab-dashboard';
  const rosTab = makeElement('ros-tab');
  rosTab.dataset.tab = 'tab-ros';
  const tabs = [dashboardTab, rosTab];

  const dashboard = makeElement('tab-dashboard', ['active']);
  const ros = makeElement('tab-ros');
  const miniControl = makeElement('tab-fleet-control');
  const contents = [dashboard, ros, miniControl];
  const mainLayout = makeElement('main-layout');
  const miniControlButton = makeElement('btn-mini-control');
  const miniControlLabel = makeElement('mini-control-button-label');
  miniControlLabel.textContent = '미니관제';

  const elements = {
    'tab-dashboard': dashboard,
    'tab-ros': ros,
    'tab-fleet-control': miniControl,
    'main-layout': mainLayout,
    'btn-mini-control': miniControlButton,
    'mini-control-button-label': miniControlLabel
  };
  const saved = new Map();
  const FleetControl = {
    activate: jest.fn(),
    deactivate: jest.fn()
  };

  const context = {
    document: {
      getElementById: jest.fn(id => elements[id] || null),
      querySelectorAll: jest.fn(selector => {
        if (selector === '.tab-btn') return tabs;
        if (selector === '.tab-content') return contents;
        return [];
      }),
      querySelector: jest.fn(selector => {
        const match = selector.match(/^\.tab-btn\[data-tab="(.+)"\]$/);
        return match ? tabs.find(tab => tab.dataset.tab === match[1]) || null : null;
      })
    },
    localStorage: {
      getItem: jest.fn(key => saved.get(key) || null)
    },
    _safeSetItem: jest.fn((key, value) => saved.set(key, value)),
    FleetControl,
    SSHTerminal: { terminal: null },
    setTimeout,
    clearTimeout
  };

  vm.createContext(context);
  vm.runInContext(
    `const TestApp = {
      setupCameraTabCheckboxes() {},
      setupCameraSnapshot() {},
      setupFontSizeControl() {},
      setupMobileSidebar() {},
      setupTabs() {${methodMatch[1]}
      }
    };
    TestApp.setupTabs();
    globalThis.__TestApp = TestApp;`,
    context
  );

  return {
    dashboardTab,
    rosTab,
    dashboard,
    ros,
    miniControl,
    mainLayout,
    miniControlButton,
    miniControlLabel,
    FleetControl
  };
}

describe('Mini control workspace navigation', () => {
  test('switches to mini control and returns to the previous workspace', () => {
    const ui = loadSetupTabs();

    ui.rosTab.click();
    ui.miniControlButton.click();

    expect(ui.miniControl.classList.contains('active')).toBe(true);
    expect(ui.mainLayout.classList.contains('fleet-control-mode')).toBe(true);
    expect(ui.miniControlButton.classList.contains('active')).toBe(true);
    expect(ui.miniControlLabel.textContent).toBe('작업화면');
    expect(ui.FleetControl.activate).toHaveBeenCalled();

    ui.miniControlButton.click();

    expect(ui.ros.classList.contains('active')).toBe(true);
    expect(ui.rosTab.classList.contains('active')).toBe(true);
    expect(ui.mainLayout.classList.contains('fleet-control-mode')).toBe(false);
    expect(ui.miniControlLabel.textContent).toBe('미니관제');
    expect(ui.FleetControl.deactivate).toHaveBeenCalled();
  });

  test('is exposed as a header workspace button, not a regular or split tab', () => {
    const html = fs.readFileSync(
      path.join(__dirname, '..', 'public', 'index.html'),
      'utf8'
    );

    expect(html).toContain('id="btn-mini-control"');
    expect(html).toContain('<h4>미니관제</h4>');
    expect(html).not.toMatch(/class="tab-btn" data-tab="tab-fleet-control"/);
    expect(html).not.toMatch(/<option value="tab-fleet-control">/);
  });
});
