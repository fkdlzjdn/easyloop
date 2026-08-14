const EventEmitter = require('events');
const { listRosServices, waitForRosService } = require('../server/ros-service-wait');

function fakeChild(output = '', exitEvent = 'close') {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = { resume: jest.fn() };
  child.kill = jest.fn();
  process.nextTick(() => {
    if (output) child.stdout.emit('data', Buffer.from(output));
    child.emit(exitEvent, 0);
  });
  return child;
}

describe('ROS service readiness wait', () => {
  test('parses rosservice list output', async () => {
    const spawnFn = jest.fn(() => fakeChild('/rosout/get_loggers\n/rosapi/nodes\n'));

    await expect(listRosServices({ ROS_MASTER_URI: 'test' }, { spawnFn }))
      .resolves.toEqual(['/rosout/get_loggers', '/rosapi/nodes']);
    expect(spawnFn).toHaveBeenCalledWith(
      'rosservice',
      ['list'],
      expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] })
    );
  });

  test('waits until the requested ROS service appears', async () => {
    const listServicesFn = jest.fn()
      .mockResolvedValueOnce(['/rosout/get_loggers'])
      .mockResolvedValueOnce(['/rosout/get_loggers', '/rosapi/nodes']);
    const delayFn = jest.fn(async () => {});

    await expect(waitForRosService('/rosapi/nodes', 1000, {}, {
      listServicesFn,
      delayFn,
      pollIntervalMs: 1
    })).resolves.toBe(true);
    expect(listServicesFn).toHaveBeenCalledTimes(2);
    expect(delayFn).toHaveBeenCalledTimes(1);
  });

  test('returns false when service discovery keeps failing', async () => {
    const listServicesFn = jest.fn(async () => []);
    let now = 0;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => {
      now += 100;
      return now;
    });

    await expect(waitForRosService('/rosapi/nodes', 50, {}, {
      listServicesFn,
      delayFn: async () => {},
      pollIntervalMs: 1
    })).resolves.toBe(false);
    nowSpy.mockRestore();
  });
});
