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
    dataset: {},
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
    'loop-closure-notice-count': makeElement(),
    'loop-closure-notice-title': makeElement(),
    'loop-closure-notice-message': makeElement(),
    'slam-dimension-status': makeElement(),
    'slam-active-dimension': makeElement(),
    'slam-dimension-detail': makeElement()
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
    clearTimeout,
    setInterval,
    clearInterval
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

function lioGraphMessage(loopPairs = 0) {
  const points = [];
  for (let index = 0; index < loopPairs; index += 1) {
    points.push(
      { x: index + 10, y: index + 20, z: 0.5 },
      { x: index + 30, y: index + 40, z: 0.6 }
    );
  }
  return {
    markers: [
      { ns: 'loop_nodes', points },
      { ns: 'loop_edges', points }
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

  test('supports both slam_toolbox 2D and LIO-SAM 3D accepted closure signals', () => {
    expect(source).toContain('/slam_toolbox/karto_graph_visualization');
    expect(source).toContain("namespace === 'loop_slam_edges'");
    expect(source).toContain('/lio_sam/mapping/loop_closure_constraints');
    expect(source).toContain("namespace === 'loop_edges'");
    expect(source).toContain("'rosgraph_msgs/Log'");
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
    expect(elements['loop-closure-status-title'].textContent).toBe('Loop Closure 성사됨 · 2D');
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

  test('detects R51 LIO-SAM loop_edges as a confirmed 3D graph correction', () => {
    jest.useFakeTimers();
    const { manager, App, elements } = loadManager();
    manager._slamRunning = true;
    App.robotSlots[0].routineMode = 'SLAM';

    manager._handleLioLoopConstraints(0, lioGraphMessage(2));

    expect(App.robotSlots[0].slamProfile.mapping.dimension).toBe('3d');
    expect(manager._loopClosureCount).toBe(2);
    expect(manager._loopClosureConfirmedCount).toBe(2);
    expect(elements['slam-active-dimension'].textContent).toBe('Mapping · 3D');
    expect(elements['loop-closure-status-title'].textContent).toBe('Loop Closure 성사됨 · 3D');
    expect(elements['loop-closure-status-count'].textContent).toBe('2회 그래프 확인');
    expect(App.toast).toHaveBeenCalledWith(
      'Loop Closure 성사! 그래프 보정 확인 (2개 동시 감지)',
      'success',
      8000
    );

    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test('recognizes R63 Loop Closed rosout once and promotes it when graph data arrives', () => {
    jest.useFakeTimers();
    const { manager, App, elements } = loadManager();
    manager._slamRunning = true;
    App.robotSlots[0].routineMode = 'SLAM';
    const log = {
      header: { stamp: { secs: 1785403487, nsecs: 448112822 } },
      name: '/R_001/slam_toolbox',
      msg: 'Loop Closed! (Response : 0.510907, Vertex : 25, Chain : (0 ~ 14))'
    };

    manager._handleLoopClosureLog(0, log);
    manager._handleLoopClosureLog(0, log);

    expect(manager._loopClosureCount).toBe(1);
    expect(manager._loopClosureConfirmedCount).toBe(0);
    expect(manager._loopClosureDetectedCount).toBe(1);
    expect(elements['loop-closure-status'].classList.contains('detected')).toBe(true);
    expect(elements['loop-closure-status-title'].textContent).toBe('Loop Closure 로그 감지 · 2D');
    expect(elements['loop-closure-notice-title'].textContent).toBe('Loop Closure 성사 로그 감지!');
    expect(App.toast).toHaveBeenCalledTimes(1);

    manager._handleSlamGraph(0, graphMessage(1));

    expect(manager._loopClosureCount).toBe(1);
    expect(manager._loopClosureConfirmedCount).toBe(1);
    expect(elements['loop-closure-status'].classList.contains('success')).toBe(true);
    expect(elements['loop-closure-status-title'].textContent).toBe('Loop Closure 성사됨 · 2D');
    expect(App.toast).toHaveBeenCalledTimes(1);

    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test('tracks Mapping and Localization dimensions independently', () => {
    const { manager, App, elements } = loadManager();
    manager._slamRunning = true;
    App.robotSlots[0].routineMode = 'SLAM';
    manager._handleSlamGraph(0, graphMessage(0));

    manager._slamRunning = false;
    App.robotSlots[0].routineMode = 'NAV';
    manager._recordSlamDimension(
      0,
      '3d',
      'LIO-SAM',
      '3D odometry publisher 확인',
      75,
      'localization'
    );

    expect(App.robotSlots[0].slamProfile.mapping.dimension).toBe('2d');
    expect(App.robotSlots[0].slamProfile.localization.dimension).toBe('3d');
    expect(elements['slam-active-dimension'].textContent).toBe('Localization · 3D');
    expect(elements['slam-dimension-detail'].textContent)
      .toBe('Mapping 2D · Localization 3D');
  });

  test('keeps Mapping path and Vertex data for Lifelong, but resets them for a new SLAM', () => {
    jest.useFakeTimers();
    const { manager } = loadManager();
    manager.robotPose = { x: 4, y: 2, yaw: 0.5 };
    manager._breadcrumbTrail = [
      { x: 1, y: 1, yaw: 0, time: 1 },
      { x: 2, y: 1, yaw: 0, time: 2 }
    ];
    manager._slamVertices = [{ x: 2, y: 1, yaw: 0, idx: 0, time: 2 }];
    manager._slamGraphNodes = [{ x: 2, y: 1, id: 7 }];

    manager._startSlamTrail(true);
    expect(manager._breadcrumbTrail).toHaveLength(2);
    expect(manager._slamVertices).toHaveLength(1);
    expect(manager._slamGraphNodes).toHaveLength(1);
    manager._stopSlamTrail();

    manager._startSlamTrail(false);
    expect(manager._breadcrumbTrail).toHaveLength(0);
    expect(manager._slamVertices).toHaveLength(0);
    expect(manager._slamGraphNodes).toHaveLength(0);
    manager._stopSlamTrail();
    jest.useRealTimers();
  });

  test('does not discard the retained graph on Lifelong DELETEALL transition', () => {
    const { manager } = loadManager();
    manager._lifelongRunning = true;
    manager._slamGraphNodes = [{ x: 1, y: 2, id: 3 }];
    manager._slamGraphEdges = [{ x1: 1, y1: 2, x2: 2, y2: 3 }];

    manager._handleSlamGraph(0, {
      markers: [{ ns: '', action: 3, points: [] }]
    });

    expect(manager._slamGraphNodes).toHaveLength(1);
    expect(manager._slamGraphEdges).toHaveLength(1);
  });
});
