const RobotCompatibility = require('../public/js/robot-compatibility');
const { parseProbe, createRos2Runtime } = require('../server/ros2-runtime');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class FakeWebSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = FakeWebSocket.OPEN;
  }
  close() {
    this.readyState = 3;
    this.emit('close');
  }
  send() {}
}
FakeWebSocket.OPEN = 1;
FakeWebSocket.Server = class {
  handleUpgrade(_req, _socket, _head, callback) { callback(new FakeWebSocket()); }
};

function invokeRoute(runtime, path, body) {
  const handler = runtime.router.stack.find(layer => layer.route?.path === path).route.stack[0].handle;
  return new Promise(resolve => {
    const res = {
      status() { return this; },
      json(value) { resolve(value); return this; },
      sendStatus(code) { resolve({ status: code }); return this; }
    };
    handler({ body }, res);
  });
}

describe('ROS runtime mode selection', () => {
  test('detects the R_006 Jazzy shell and preserves manual ROS2 evidence', () => {
    expect(parseProbe([
      'EASYLOOP_ROS_VERSION=2',
      'EASYLOOP_ROS_DISTRO=jazzy',
      'EASYLOOP_ROS2_PATH=/opt/ros/jazzy/bin/ros2',
      'EASYLOOP_HAS_ROS2=1'
    ].join('\n'))).toMatchObject({
      rosMajor: 2, distro: 'jazzy', hasRos1: false, hasRos2: true, ros2Distro: 'jazzy'
    });
    expect(parseProbe('EASYLOOP_ROS_VERSION=1\nEASYLOOP_HAS_ROS1=1')).toMatchObject({ rosMajor: 1 });
    expect(parseProbe('EASYLOOP_HAS_ROS1=1\nEASYLOOP_HAS_ROS2=1')).toMatchObject({ rosMajor: null });
  });

  const ns = '/R_006';
  const topics = {
    [`${ns}/map`]: 'nav_msgs/msg/OccupancyGrid',
    [`${ns}/cmd_vel`]: 'geometry_msgs/msg/Twist',
    [`${ns}/cmd_vel_selected`]: 'geometry_msgs/msg/Twist',
    [`${ns}/cmd_vel_teleop`]: 'geometry_msgs/msg/Twist',
    [`${ns}/spx/operation_mode`]: 'std_msgs/msg/String',
    [`${ns}/battery_state`]: 'sensor_msgs/msg/BatteryState',
    [`${ns}/robot_state`]: 'spx_robot_msgs/msg/RobotState',
    [`${ns}/io/state_monitor/mode`]: 'std_msgs/msg/Bool',
    [`${ns}/io/state_monitor/sto`]: 'std_msgs/msg/Bool',
    [`${ns}/io/state_monitor/brake`]: 'std_msgs/msg/Bool'
  };
  const services = {
    [`${ns}/spx/set_mode`]: 'spx_robot_msgs/srv/SetMode',
    [`${ns}/io/set/auto_charge_relay`]: 'std_srvs/srv/SetBool',
    [`${ns}/map_server/load_map`]: 'nav2_msgs/srv/LoadMap'
  };
  const build = (rosMode = 'auto', topicTypes = topics) => RobotCompatibility._buildProfile(
    { robotId: 'R_006', rosMode, robotModel: 'sl400_vri' },
    Object.keys(services), Object.keys(topicTypes), services, topicTypes
  );

  test('maps R_006 telemetry, charging and jog through the safety mux', () => {
    const profile = build('ros2');
    expect(profile.transport.rosMajor).toBe(2);
    expect(profile.mapping.commandName).toBe(`${ns}/spx/set_mode`);
    expect(profile.map.topic).toBe(`${ns}/map`);
    expect(profile.map.reloadService).toBe(`${ns}/map_server/load_map`);
    expect(RobotCompatibility.mapReloadRequest(profile, '/home/syscon/ROS_DB/map/map.yaml'))
      .toEqual({ map_url: '/home/syscon/ROS_DB/map/map.yaml' });
    expect(profile.monitoring.topics.bms.name).toBe(`${ns}/battery_state`);
    expect(profile.monitoring.topics.robotState.type).toBe('spx_robot_msgs/msg/RobotState');
    expect(profile.monitoring.topics.manualSelect.name).toBe(`${ns}/io/state_monitor/mode`);
    expect(profile.chassis.drive.topic).toBe(`${ns}/cmd_vel_teleop`);
    expect(profile.chassis.charge.service).toBe(`${ns}/io/set/auto_charge_relay`);
    expect(profile.task.verified).toBe(false);
  });

  test('manual mode mismatch and missing safety path keep motion blocked', () => {
    expect(build('ros1').controlReady).toBe(false);
    const withoutMux = { ...topics };
    delete withoutMux[`${ns}/cmd_vel_selected`];
    expect(build('ros2', withoutMux).chassis.drive.verified).toBe(false);
  });

  test('EasyLoop ROS2 selection uses the SSH bridge URL path', async () => {
    const rosManager = { connectSlot: jest.fn() };
    const fetchMock = jest.fn(async () => ({
      json: async () => ({ success: true, rosMajor: 2, distro: 'jazzy', sessionId: 'session-r006' })
    }));
    const source = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
    const context = {
      document: { addEventListener: jest.fn() },
      window: { addEventListener: jest.fn() },
      localStorage: { getItem: () => null, setItem: jest.fn(), removeItem: jest.fn() },
      fetch: fetchMock, AbortController, setTimeout, clearTimeout,
      RosManager: rosManager, console
    };
    const app = vm.runInNewContext(`${source}\nApp`, context);
    app.robotSlots = [{
      ip: '192.168.20.56', robotId: 'R_006', sshPort: 22,
      sshPassword: '', rosMode: 'ros2', tunnelMode: false
    }];
    await app.connectSlot(0);
    expect(app.robotSlots[0].ros2SessionId).toBe('session-r006');
    expect(app.robotSlots[0].rosDetected).toBe('ROS2 jazzy');
    expect(rosManager.connectSlot).toHaveBeenCalledWith(0, '192.168.20.56', 'R_006');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).mode).toBe('ros2');
    app.robotSlots[0].rosMode = 'ros1';
    app.robotSlots[0].ros2SessionId = null;
    fetchMock.mockClear();
    rosManager.connectSlot.mockClear();
    await app.connectSlot(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rosManager.connectSlot).toHaveBeenCalledWith(0, '192.168.20.56', 'R_006');
  });

  test('ROS2 BatteryState percentage is presented as EasyLoop SOC', () => {
    const source = fs.readFileSync(path.join(__dirname, '../public/js/ros-manager.js'), 'utf8');
    const app = { activeSlotIndex: -1, robotSlots: [{}] };
    const manager = vm.runInNewContext(`${source}\nRosManager`, {
      document: { addEventListener: jest.fn() }, App: app, console,
      setTimeout, clearTimeout, setInterval, clearInterval
    });
    manager._handleSlotBmsData(0, {
      voltage: 51.2, current: 2.5, percentage: 0.64, power_supply_status: 1
    });
    expect(app.robotSlots[0].bms).toEqual({
      voltage: 51.2, current: 2.5, soc: 64, charging: true, receivedAt: expect.any(Number), socValid: true
    });
    manager._handleSlotBmsData(0, {
      voltage: 51.2, current: 0, percentage: -1, power_supply_status: 0
    });
    expect(app.robotSlots[0].bms.soc).toBe(0);
    expect(app.robotSlots[0].bms.socValid).toBe(false);
  });

  test('manual ROS2 mode and simultaneous map/pose channels share one SSH session', async () => {
    const conn = {
      end: jest.fn(),
      exec: jest.fn((command, callback) => {
        const stream = new EventEmitter();
        stream.stderr = new EventEmitter();
        stream.write = jest.fn();
        stream.close = jest.fn(() => stream.emit('close', 0));
        callback(null, stream);
        if (command.includes('EASYLOOP_BRIDGE_READY')) {
          process.nextTick(() => {
            stream.emit('data', Buffer.from('EASYLOOP_BRIDGE_READY=1\n'));
            stream.emit('close', 0);
          });
        } else if (command.includes('EASYLOOP_ROS_VERSION')) {
          process.nextTick(() => {
            stream.emit('data', Buffer.from('EASYLOOP_ROS_VERSION=1\nEASYLOOP_ROS2_PATH=/opt/ros/jazzy/bin/ros2\nEASYLOOP_HAS_ROS1=1\nEASYLOOP_HAS_ROS2=1\n'));
            stream.emit('close', 0);
          });
        }
      })
    };
    const runtime = createRos2Runtime({
      createSSHConnection: (_config, ready) => {
        process.nextTick(ready);
        return conn;
      },
      WebSocket: FakeWebSocket,
      getAuthToken: () => 'test-owner'
    });
    const result = await invokeRoute(runtime, '/prepare', {
      host: '192.168.20.56', port: 22, username: 'syscon', mode: 'ros2', robotId: 'R_006'
    });
    expect(result).toMatchObject({ success: true, rosMajor: 2, hasRos1: true, hasRos2: true });
    const request = { url: `/ws-ros2?session=${result.sessionId}`, headers: { host: 'localhost' } };
    const socket = { write: jest.fn(), destroy: jest.fn() };
    runtime.handleUpgrade(request, socket, Buffer.alloc(0));
    runtime.handleUpgrade(request, socket, Buffer.alloc(0));
    expect(runtime.sessions.get(result.sessionId).channels.size).toBe(2);
    expect(conn.exec.mock.calls.some(([command]) => command.includes('source /opt/ros/jazzy/setup.bash'))).toBe(true);
    expect([...runtime.sessions.get(result.sessionId).channels].every(channel => channel.ws.readyState === 1)).toBe(true);
    expect((await invokeRoute(runtime, '/close', { sessionId: result.sessionId })).success).toBe(true);
    expect(conn.end).toHaveBeenCalledTimes(1);
  });
});
