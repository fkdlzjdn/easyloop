const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadScanFill(mode, initialValue = 50) {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'ros-manager.js'),
    'utf8'
  );
  const elements = {
    'map-canvas': {},
    'scan-fill-mode': { value: mode }
  };
  const App = { toast: jest.fn(), robotSlots: [], activeSlotIndex: -1 };
  const context = {
    App,
    console,
    document: {
      addEventListener: jest.fn(),
      getElementById: jest.fn(id => elements[id] || null),
      querySelectorAll: jest.fn(() => [])
    },
    window: { addEventListener: jest.fn() },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.__RosManager = RosManager;`, context);
  const manager = context.__RosManager;
  manager.lastMapMsg = {
    info: {
      width: 5,
      height: 5,
      resolution: 1,
      origin: { position: { x: 0, y: 0 } }
    },
    data: new Int8Array(25).fill(initialValue)
  };
  manager.lastScanMsg = {
    angle_min: 0,
    angle_increment: 0,
    range_min: 0.01,
    range_max: 10,
    ranges: [1]
  };
  manager.robotPose = { x: 1, y: 2, yaw: 0 };
  manager._canvasToMapPixel = jest.fn((x, y) => ({ x, y }));
  manager._saveEditHistorySnapshot = jest.fn();
  manager.requestRender = jest.fn();
  const index = (x, y) => (4 - y) * 5 + x;
  return { manager, App, index };
}

describe('Map Scan Fill modes', () => {
  test('exposes all three Scan Fill policies in the edit toolbar', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    expect(html).toContain('id="scan-fill-mode"');
    expect(html).toContain('<option value="draw">그리기만</option>');
    expect(html).toContain('<option value="both" selected>그리기 + 지우기</option>');
    expect(html).toContain('<option value="clear">지우기만</option>');
  });

  test('draw only preserves existing cells and stamps LiDAR obstacles', () => {
    const { manager, index } = loadScanFill('draw', 50);

    manager._applyScanFillRegion(1, 1, 3, 3);

    expect(manager.lastMapMsg.data[index(2, 2)]).toBe(100);
    expect(manager.lastMapMsg.data[index(1, 1)]).toBe(50);
    expect(manager._saveEditHistorySnapshot).toHaveBeenCalledTimes(1);
  });

  test('draw and clear frees the region before stamping LiDAR obstacles', () => {
    const { manager, index } = loadScanFill('both', 100);

    manager._applyScanFillRegion(1, 1, 3, 3);

    expect(manager.lastMapMsg.data[index(2, 2)]).toBe(100);
    expect(manager.lastMapMsg.data[index(1, 1)]).toBe(0);
  });

  test('clear only works without LiDAR or robot pose and leaves no obstacle stamp', () => {
    const { manager, index, App } = loadScanFill('clear', 100);
    manager.lastScanMsg = null;
    manager.robotPose = null;

    manager._applyScanFillRegion(1, 1, 3, 3);

    expect(manager.lastMapMsg.data[index(2, 2)]).toBe(0);
    expect(manager.lastMapMsg.data[index(1, 1)]).toBe(0);
    expect(App.toast).toHaveBeenCalledWith(expect.stringContaining('지우기만'), 'success');
  });
});
