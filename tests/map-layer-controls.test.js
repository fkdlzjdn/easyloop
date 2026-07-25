const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'public', 'js', 'ros-manager.js'), 'utf8');
const style = fs.readFileSync(path.join(root, 'public', 'css', 'style.css'), 'utf8');

describe('Map layer controls contract', () => {
  test('defaults to Map and Robot while every additional overlay is opt-in', () => {
    expect(html).toMatch(/id="chk-map"\s+checked/);
    expect(html).toMatch(/id="chk-robot-pose"\s+checked/);

    [
      'chk-lidar',
      'chk-lidar-front',
      'chk-lidar-rear',
      'chk-footprint',
      'chk-local-costmap',
      'chk-nav-path',
      'chk-nav-goal',
      'chk-dock-pose',
      'chk-mapping-path',
      'chk-map-correction'
    ].forEach(id => {
      expect(html).toMatch(new RegExp(`id="${id}"(?![^>]*checked)`));
    });
    expect(html).toContain('id="map-layer-count" class="map-layer-count">2');
  });

  test('uses the established Setup and SR-AMR-Base topic names', () => {
    [
      '/scan',
      '/scan_1',
      '/scan_2',
      '/move_base/local_costmap/costmap',
      '/best_local_trajectories_nav',
      '/move_base/WaypointsGlobalPlanner/current_goal',
      '/lio_sam/mapping/path',
      '/spx/operation_mode',
      '/spcore/MODE'
    ].forEach(topic => expect(source).toContain(topic));
    expect(source).toContain("'tf-static', '/tf_static'");
  });

  test('renders only enabled layers and auto-enables Mapping Path in mapping modes', () => {
    [
      'chk-map',
      'chk-robot-pose',
      'chk-lidar-front',
      'chk-lidar-rear',
      'chk-footprint',
      'chk-local-costmap',
      'chk-nav-path',
      'chk-nav-goal',
      'chk-dock-pose',
      'chk-mapping-path'
    ].forEach(id => expect(source).toContain(`_isLayerEnabled('${id}')`));
    expect(source).toContain('this._enableMappingPathLayer()');
    expect(source).toContain("MAPPING: 'SLAM'");
    expect(source).toContain("PARTIAL_MAPPING: 'LIFELONG'");
  });

  test('keeps the layer picker compact and scrollable on different resolutions', () => {
    expect(style).toMatch(/\.map-layer-popover\s*\{[\s\S]*?max-height:[\s\S]*?overflow-y:\s*auto/);
    expect(style).toContain('.map-layer-count');
    expect(style).toContain('.map-correction-badge[hidden]');
    expect(html).toContain('js/ros-manager.js?v=20260725-loop-closure-ui');
  });
});
