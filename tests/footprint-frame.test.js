const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'ros-manager.js'),
  'utf8'
);

function loadManager() {
  const topics = [];
  const createdCanvases = [];
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
      addEventListener: jest.fn(),
      createElement: jest.fn(() => {
        const context2d = {
          createImageData: jest.fn((width, height) => ({
            data: new Uint8ClampedArray(width * height * 4)
          })),
          putImageData: jest.fn()
        };
        const canvas = { width: 0, height: 0, getContext: jest.fn(() => context2d) };
        createdCanvases.push({ canvas, context2d });
        return canvas;
      })
    },
    window: { addEventListener: jest.fn() },
    setTimeout,
    clearTimeout
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.__RosManager = RosManager;`, context);
  context.__RosManager.requestRender = jest.fn();
  context.__RosManager._testTopics = topics;
  context.__RosManager._testCreatedCanvases = createdCanvases;
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
  test('requests CBOR-compressed throttled single-item map delivery', () => {
    const manager = loadManager();

    manager._subscribeMapForSlot(0, '/R_001/map');

    expect(manager._testTopics[0].options).toMatchObject({
      name: '/R_001/map',
      messageType: 'nav_msgs/OccupancyGrid',
      compression: 'cbor',
      queue_length: 1,
      throttle_rate: manager.MAP_THROTTLE_MS
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

  test('accepts a new Mapping revision even when sampled cells are unchanged', () => {
    const manager = loadManager();
    const info = {
      width: 100,
      height: 100,
      resolution: 0.02,
      origin: { position: { x: 0, y: 0 } }
    };
    const data = new Array(10000).fill(-1);
    const navMap = {
      header: { seq: 10, stamp: { secs: 100, nsecs: 0 } },
      info,
      data
    };
    const mappingRevision = {
      header: { seq: 11, stamp: { secs: 105, nsecs: 0 } },
      info,
      data: [...data]
    };
    // Change a cell that the old 64-cell sample would not necessarily inspect.
    mappingRevision.data[1234] = 100;
    manager._slamRunning = true;
    manager._mappingStaleMapSignature = manager._mapMessageSignature(navMap);

    expect(manager.renderMap(mappingRevision)).toBe(true);
    expect(manager.lastMapMsg).toBe(mappingRevision);
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

  test('builds live Mapping pixels in yielded chunks', () => {
    jest.useFakeTimers();
    const manager = loadManager();
    manager.MAP_BUILD_BUDGET_MS = 0;
    const data = new Array(100).fill(-1);
    data[55] = 100;
    const message = { info: { width: 10, height: 10 }, data };

    expect(manager._queueMapImageBuild(message)).toBe(null);
    expect(manager._mapImageSource).not.toBe(data);

    jest.runAllTimers();

    expect(manager._mapImageSource).toBe(data);
    expect(manager._mapImageCanvas).toBe(manager._testCreatedCanvases[0].canvas);
    expect(manager._testCreatedCanvases[0].context2d.putImageData).toHaveBeenCalledTimes(1);
    expect(manager.requestRender).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});
