const {
  findListeningPids,
  isRosMasterCommand,
  stopLocalRosMaster
} = require('../server/ros-master-cleanup');

describe('local ROS master cleanup', () => {
  test('finds the process listening on ROS master port through lsof', () => {
    const spawnSync = jest.fn(() => ({ status: 0, stdout: '321\n321\n654\n' }));

    expect(findListeningPids(11311, { spawnSync })).toEqual([321, 654]);
    expect(spawnSync).toHaveBeenCalledWith(
      'lsof',
      ['-nP', '-t', '-iTCP:11311', '-sTCP:LISTEN'],
      expect.any(Object)
    );
  });

  test('recognizes ROS master commands but rejects unrelated listeners', () => {
    expect(isRosMasterCommand(
      '/usr/bin/python3 /opt/ros/noetic/bin/rosmaster --core -p 11311'
    )).toBe(true);
    expect(isRosMasterCommand('bash -c source setup.bash && roscore')).toBe(true);
    expect(isRosMasterCommand('node unrelated-service.js --port 11311')).toBe(false);
  });

  test('terminates only verified ROS master listeners', () => {
    const spawnSync = jest.fn(() => ({ status: 0, stdout: '321\n654\n' }));
    const fs = {
      readFileSync: jest.fn(path => path.includes('/321/')
        ? '/usr/bin/python3\0/opt/ros/noetic/bin/rosmaster\0--core\0'
        : 'node\0unrelated-service.js\0')
    };
    const kill = jest.fn();
    const logger = { log: jest.fn(), warn: jest.fn() };

    const result = stopLocalRosMaster({
      owned: true,
      spawnSync,
      fs,
      kill,
      logger
    });

    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(321, 'SIGTERM');
    expect(result.terminated).toHaveLength(1);
    expect(result.skipped).toEqual([
      { pid: 654, command: 'node unrelated-service.js' }
    ]);
  });

  test('never inspects or terminates a ROS master not owned by Test Mode', () => {
    const spawnSync = jest.fn();
    const kill = jest.fn();
    const logger = { log: jest.fn(), warn: jest.fn() };

    const result = stopLocalRosMaster({
      owned: false,
      spawnSync,
      kill,
      logger
    });

    expect(result.skippedOwnership).toBe(true);
    expect(result.terminated).toEqual([]);
    expect(spawnSync).not.toHaveBeenCalled();
    expect(kill).not.toHaveBeenCalled();
  });
});
