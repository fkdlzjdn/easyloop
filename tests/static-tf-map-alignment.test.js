const fs = require('fs'), path = require('path'), vm = require('vm');

function harness() {
  const topics = [], elements = new Map([['map-canvas', { width: 1000, height: 1000 }]]);
  const slot = { robotId: 'R_006', ip: '192.168.20.56', ros: {}, ros2SessionId: 'mock-only', connected: true, subscriptions: {} };
  class Topic {
    constructor(options) { Object.assign(this, options); topics.push(this); }
    subscribe(callback) { this.callback = callback; }
    unsubscribe() {}
  }
  const app = { activeSlotIndex: 0, robotSlots: [slot] };
  const manager = vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/ros-manager.js'), 'utf8') + '\nRosManager', {
    App: app, ROSLIB: { Topic }, console, Date, setTimeout, clearTimeout, setInterval, clearInterval,
    document: { addEventListener() {}, getElementById: id => elements.get(id) || null }
  });
  manager.requestRender = jest.fn(); manager.displayPose = jest.fn();
  const edge = (parent, child, x = 0, y = 0, yaw = 0, rid = 'R_006') => ({ header: { frame_id: `${rid}/${parent}` },
    child_frame_id: `${rid}/${child}`, transform: { translation: { x, y, z: 0 }, rotation: { x: 0, y: 0, z: Math.sin(yaw / 2), w: Math.cos(yaw / 2) } } });
  const send = (...transforms) => manager._handleSlotTfStatic(0, { transforms });
  const lidar = () => send(edge('base_footprint', 'base_link'), edge('base_link', 'base_laser_link'),
    edge('base_laser_link', 'base_scan1', 0.3315), edge('base_laser_link', 'base_scan2', -0.3315, 0, Math.PI));
  return { manager, slot, app, topics, edge, send, lidar };
}

describe('ROS2 map and lidar static coordinate alignment', () => {
  test('separate camera broadcaster packets never erase the front/rear lidar offsets', () => {
    const h = harness(); h.lidar();
    h.send(h.edge('cam_1_link', 'cam_1_depth_frame')); h.send(h.edge('base_link', 'cam_1_link', 0.3815));
    expect(h.slot.tfStaticMap.base_scan1.x).toBeCloseTo(0.3315);
    expect(h.slot.tfStaticMap.base_scan2.x).toBeCloseTo(-0.3315);
    expect(h.slot.tfStaticMap.base_scan2.r00).toBeCloseTo(-1);
    expect(h.slot.tfStaticMap.cam_1_depth_frame.x).toBeCloseTo(0.3815);
  });
  test('child-first replay resolves only after its parent chain arrives', () => {
    const h = harness(); h.send(h.edge('base_laser_link', 'base_scan1', 0.3315));
    expect(h.slot.tfStaticMap.base_scan1).toBeUndefined();
    h.send(h.edge('base_link', 'base_laser_link', 0.1));
    expect(h.slot.tfStaticMap.base_scan1.x).toBeCloseTo(0.4315);
  });
  test('updated edges rebuild descendants and foreign namespaces cannot overwrite this robot', () => {
    const h = harness(); h.lidar(); h.send(h.edge('base_link', 'base_laser_link', 0.2));
    h.send(h.edge('base_laser_link', 'base_scan1', 99, 0, 0, 'R_025'));
    expect(h.slot.tfStaticMap.base_scan1.x).toBeCloseTo(0.5315);
  });
  test('the same physical sensor is expressed relative to the base frame of the live pose, including inverse edges', () => {
    const h = harness(); h.send(h.edge('base_footprint', 'base_link', 1, 0, Math.PI / 2), h.edge('base_link', 'laser', 0.5));
    expect(h.slot.tfStaticMap.laser.x).toBeCloseTo(1); expect(h.slot.tfStaticMap.laser.y).toBeCloseTo(0.5);
    h.manager._handleSlotTf(0, { transforms: [h.edge('odom', 'base_link')] });
    expect(h.slot.tfPoseBaseFrame).toBe('base_link');
    expect(h.slot.tfStaticMap.laser.x).toBeCloseTo(0.5); expect(h.slot.tfStaticMap.laser.y).toBeCloseTo(0);
    expect(h.slot.tfStaticMap.base_footprint.x).toBeCloseTo(0); expect(h.slot.tfStaticMap.base_footprint.y).toBeCloseTo(1);
  });
  test('replacement connections clear previous static edges', () => {
    const h = harness(); h.lidar(); h.slot.ros = {};
    h.send(h.edge('base_link', 'camera'));
    expect(h.slot.tfStaticMap.base_scan1).toBeUndefined();
    expect(h.slot.tfStaticMap.camera).toBeDefined();
  });
  test('static replay is not throttled or constrained to a one-packet queue, and callbacks from old connections are ignored', () => {
    const h = harness();
    for (const name of ['_subscribeVerifiedHealth', '_subscribeSlotTf', '_subscribeSlotAmcl', '_ensureSlotPoseConnection', '_syncLoopClosureLogSubscription', '_fetchFootprintParam']) h.manager[name] = jest.fn();
    h.manager.subscribeSlotMonitoring(0);
    const subscription = h.slot.subscriptions['tf-static'];
    expect(subscription).toMatchObject({ throttle_rate: 0, queue_length: 0 });
    h.slot.ros = {}; subscription.callback({ transforms: [h.edge('base_link', 'laser')] });
    expect(h.slot.tfStaticMap).toBeUndefined();
  });
  test('rear lidar rays rotate by pi and translate by the actual mounting offset; unresolved ROS2 frames are not drawn at the robot center', () => {
    const h = harness(); h.lidar(); h.manager.robotPose = { x: 0, y: 0, yaw: 0 }; h.manager.mapZoom = 1;
    const ctx = { save: jest.fn(), restore: jest.fn(), translate: jest.fn(), rotate: jest.fn(), fillRect: jest.fn() };
    const scan = { header: { frame_id: 'R_006/base_scan2' }, angle_min: 0, angle_increment: 1, range_min: 0.1, range_max: 10, ranges: [1] };
    h.manager._renderLidarOnMap(ctx, 100, 100, 0.05, { position: { x: 0, y: 0 } }, scan);
    expect(ctx.fillRect.mock.calls[0][0] + 1.25).toBeCloseTo(-1.3315 / 0.05);
    ctx.fillRect.mockClear(); scan.header.frame_id = 'R_006/unknown_laser';
    h.manager._renderLidarOnMap(ctx, 100, 100, 0.05, { position: { x: 0, y: 0 } }, scan);
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });
});
