const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'public', 'js', 'ros-manager.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const style = fs.readFileSync(path.join(root, 'public', 'css', 'style.css'), 'utf8');

function makeElement(hidden = false) {
  const classes = new Set();
  return {
    hidden,
    textContent: '',
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
      contains: name => classes.has(name)
    }
  };
}

function loadManager() {
  const elements = {
    'loop-closure-status': makeElement(true),
    'loop-closure-status-title': makeElement(),
    'loop-closure-status-detail': makeElement(),
    'loop-closure-status-count': makeElement(),
    'loop-closure-notice': makeElement(true),
    'loop-closure-notice-count': makeElement()
  };
  const App = {
    activeSlotIndex: 0,
    robotSlots: [{ robotId: 'R_001' }],
    toast: jest.fn(),
    eventLog: { add: jest.fn() }
  };
  const context = {
    App,
    console,
    document: {
      getElementById: id => elements[id] || null,
      addEventListener: jest.fn()
    },
    window: { addEventListener: jest.fn() },
    requestAnimationFrame: callback => callback(),
    setTimeout,
    clearTimeout
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.__RosManager = RosManager;`, context);
  context.__RosManager.requestRender = jest.fn();
  return { manager: context.__RosManager, App, elements };
}

function graphMessage(loopPairs = 0) {
  const points = [];
  for (let index = 0; index < loopPairs; index += 1) {
    points.push(
      { x: index, y: index + 0.5 },
      { x: index + 4, y: index + 4.5 }
    );
  }
  return {
    markers: [
      { ns: 'slam_nodes', id: 1, pose: { position: { x: 1, y: 2 } } },
      { ns: 'loop_slam_edges', points }
    ]
  };
}

describe('Beginner-friendly Loop Closure UI', () => {
  test('contains an always-readable mapping status and a dismissible success notice', () => {
    expect(html).toContain('id="loop-closure-status"');
    expect(html).toContain('id="loop-closure-notice"');
    expect(html).toContain('id="btn-loop-closure-confirm"');
    expect(html).toContain('Loop Closure 성사!');
    expect(style).toContain('.loop-closure-status.success');
    expect(style).toContain('.loop-closure-notice.show');
  });

  test('uses loop_slam_edges as the actual accepted closure signal', () => {
    expect(source).toContain('/slam_toolbox/karto_graph_visualization');
    expect(source).toContain("namespace === 'loop_slam_edges'");
    expect(source).toContain('visualization_msgs/MarkerArray');
    expect(source).toContain("ctx.fillText('LOOP?'");
  });

  test('announces only when the accepted loop edge count increases', () => {
    jest.useFakeTimers();
    const { manager, App, elements } = loadManager();
    manager._slamRunning = true;
    manager._updateLoopClosureStatus();

    manager._handleSlamGraph(0, graphMessage(1));
    expect(manager._loopClosureCount).toBe(1);
    expect(elements['loop-closure-notice'].hidden).toBe(false);
    expect(elements['loop-closure-status'].classList.contains('success')).toBe(true);
    expect(elements['loop-closure-status-title'].textContent).toBe('Loop Closure 성사됨');
    expect(App.toast).toHaveBeenCalledTimes(1);
    expect(App.eventLog.add).toHaveBeenCalledTimes(1);

    manager._handleSlamGraph(0, graphMessage(1));
    expect(App.toast).toHaveBeenCalledTimes(1);

    manager._handleSlamGraph(0, graphMessage(2));
    expect(manager._loopClosureCount).toBe(2);
    expect(App.toast).toHaveBeenCalledTimes(2);

    jest.runOnlyPendingTimers();
    expect(elements['loop-closure-notice'].hidden).toBe(true);
    jest.useRealTimers();
  });
});
