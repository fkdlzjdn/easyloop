const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'ros-manager.js'),
  'utf8'
);

function loadManager() {
  const topics = [];
  class Topic {
    constructor(options) {
      this.options = options;
      topics.push(this);
    }

    subscribe(callback) {
      this.callback = callback;
    }

    unsubscribe() {}
  }
  const App = {
    activeSlotIndex: 0,
    robotSlots: [{
      robotId: 'R_001',
      ros: {},
      subscriptions: {},
      pose: { x: 10, y: 5, yaw: Math.PI / 2 }
    }]
  };
  const context = {
    App,
    ROSLIB: { Topic },
    console,
    document: {
      getElementById: jest.fn(),
      addEventListener: jest.fn()
    },
    window: { addEventListener: jest.fn() },
    setTimeout,
    clearTimeout
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.__RosManager = RosManager;`, context);
  context.__RosManager.requestRender = jest.fn();
  context.__RosManager._testTopics = topics;
  return context.__RosManager;
}

function footprint(frameId, points) {
  return {
    header: { frame_id: frameId },
    polygon: {
      points: points.map(([x, y]) => ({ x, y, z: 0 }))
    }
  };
}

describe('Footprint frame handling', () => {
  test('keeps base_link and base_footprint polygons in robot-local coordinates', () => {
    const manager = loadManager();
    manager._handleFootprintMessage(0, footprint('R_001/base_link', [
      [0.3, 0.2],
      [-0.3, 0.2],
      [-0.3, -0.2]
    ]));

    expect(manager._footprintFrame).toBe('base_link');
    expect(JSON.parse(JSON.stringify(manager._footprintPoints))).toEqual([
      { x: 0.3, y: 0.2 },
      { x: -0.3, y: 0.2 },
      { x: -0.3, y: -0.2 }
    ]);
  });

  test('converts map-frame polygons into robot-local coordinates', () => {
    const manager = loadManager();
    manager._handleFootprintMessage(0, footprint('map', [
      [9.8, 5.3],
      [9.8, 4.7],
      [10.2, 4.7]
    ]));

    expect(manager._footprintFrame).toBe('map');
    expect(manager._footprintPoints[0].x).toBeCloseTo(0.3, 6);
    expect(manager._footprintPoints[0].y).toBeCloseTo(0.2, 6);
    expect(manager._footprintPoints[1].x).toBeCloseTo(-0.3, 6);
    expect(manager._footprintPoints[1].y).toBeCloseTo(0.2, 6);
  });

  test('prefers a fresh LIO footprint while Mapping is active', () => {
    const manager = loadManager();
    manager._slamRunning = true;
    manager._handleFootprintMessage(0, footprint('base_footprint', [
      [0.4, 0.25],
      [-0.4, 0.25],
      [-0.4, -0.25]
    ]), 'lio');
    const lioPoints = JSON.stringify(manager._footprintPoints);

    manager._handleFootprintMessage(0, footprint('map', [
      [100, 100],
      [101, 100],
      [101, 101]
    ]), 'move-base');

    expect(JSON.stringify(manager._footprintPoints)).toBe(lioPoints);
  });
});

describe('Map image cache', () => {
  test('requests PNG-compressed single-item map delivery', () => {
    const manager = loadManager();

    manager._subscribeMapForSlot(0, '/R_001/map');

    expect(manager._testTopics[0].options).toMatchObject({
      name: '/R_001/map',
      messageType: 'nav_msgs/OccupancyGrid',
      compression: 'png',
      queue_length: 1
    });
    manager.unsubscribeSlotData(0, false);
  });

  test('drops only a short duplicate map replay from two publishers', () => {
    const manager = loadManager();
    const info = {
      width: 2,
      height: 2,
      resolution: 0.02,
      origin: { position: { x: 0, y: 0 } }
    };
    const first = { info, data: [0, 100, -1, 0] };
    const duplicate = { info, data: [0, 100, -1, 0] };

    manager.renderMap(first);
    manager.renderMap(duplicate);

    expect(manager.lastMapMsg).toBe(first);
    expect(manager.requestRender).toHaveBeenCalledTimes(1);
  });

  test('reuses pixels while only robot pose changes', () => {
    const manager = loadManager();
    const context2d = {
      createImageData: jest.fn((width, height) => ({
        data: new Uint8ClampedArray(width * height * 4)
      })),
      putImageData: jest.fn()
    };
    manager._mapImageCanvas = {
      width: 0,
      height: 0,
      getContext: jest.fn(() => context2d)
    };
    const data = [0, 100, -1, 0];
    const message = {
      info: { width: 2, height: 2 },
      data
    };

    const first = manager._buildMapImage(message);
    const second = manager._buildMapImage(message);

    expect(second).toBe(first);
    expect(context2d.createImageData).toHaveBeenCalledTimes(1);
    expect(context2d.putImageData).toHaveBeenCalledTimes(1);

    manager._buildMapImage({ ...message, data: [...data] });
    expect(context2d.createImageData).toHaveBeenCalledTimes(2);
  });
});
