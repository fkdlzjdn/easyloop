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
      '/lio_sam/mapping/footprint',
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
    expect(source).toContain('TestMode.setMappingMode?.(slotIndex, mode)');
    expect(source).toContain("MAPPING: 'SLAM'");
    expect(source).toContain("PARTIAL_MAPPING: 'LIFELONG'");
    expect(source).toContain('const mappingActive = this._slamRunning || this._lifelongRunning');
    expect(source).toContain('mappingActive && this._isLayerEnabled');
    expect(source).toContain('this._startSlamTrail(false)');
    expect(source).toContain('this._startSlamTrail(true)');
    expect(source).toContain('this._renderSlamTrail(ctx, width, height, resolution, origin, false)');
  });

  test('keeps the layer picker compact and scrollable on different resolutions', () => {
    expect(style).toMatch(/\.map-layer-popover\s*\{[\s\S]*?max-height:[\s\S]*?overflow-y:\s*auto/);
    expect(style).toContain('.map-layer-count');
    expect(style).toContain('.map-correction-badge[hidden]');
    expect(html).toContain('js/ros-manager.js?v=20260806-stl-ulsan-jog');
    expect(html).toContain('js/test-mode.js?v=20260728-drive-lab');
    expect(html).toContain('id="test-mapping-status"');
    expect(html).toContain('id="btn-test-mapping-demo"');
    expect(html).toContain('id="btn-save-map"');
    expect(html).toContain('id="mapping-save-confirm-modal"');
    expect(html).not.toContain('id="save-map-name"');
    expect(html).toContain('~/ROS_DB/map/map.pgm');
    expect(html).toContain('id="btn-mapping-save-no"');
    expect(html).toContain('예, 저장 후 종료');
    expect(source).toContain("this._openMappingSaveConfirm('SLAM')");
    expect(source).toContain("this._openMappingSaveConfirm('LIFELONG')");
  });

  test('organizes scattered map actions into four compact menus without dropping functions', () => {
    [
      'map-layer-menu',
      'map-view-menu',
      'map-robot-menu',
      'map-mapping-menu'
    ].forEach(id => expect(html).toContain(`id="${id}"`));

    [
      'btn-map-zoom-in',
      'btn-map-rotate-left',
      'btn-map-fullscreen',
      'btn-follow-robot',
      'btn-map-view-reset',
      'btn-set-pose-mode',
      'btn-cov-reposition',
      'btn-nav-goal-mode',
      'btn-jog-toggle-map',
      'btn-slam-start',
      'btn-lifelong-start',
      'btn-map-edit-toggle',
      'btn-lidar-align',
      'btn-save-map'
    ].forEach(id => expect(html).toContain(`id="${id}"`));

    expect(html).not.toContain('class="map-controls map-controls-row2"');
    expect(html).not.toContain('<div class="map-mapping-controls">');
    expect(style).toContain('Compact map tool dock');
    expect(style).toContain('.map-tool-actions-grid');
    expect(style).toContain('#map-view-menu .map-view-popover');
    expect(html).toMatch(/class="map-panel-heading-main"[\s\S]*?id="btn-map-fullscreen"/);
    expect(html).toContain('class="map-fullscreen-label">전체화면</span>');
    expect(source).toContain("fullscreenLabel.textContent = '전체화면 종료'");
    expect(source).toContain("btnViewReset.addEventListener('click', () => this.resetMapView())");
    expect(source).toContain('Intentionally do not change _activeTaskOverlay');
    expect(source).not.toContain("btnFullscreen.innerHTML = '✕'");
    expect(style).toMatch(/#map-view-menu \.map-view-popover\s*\{[\s\S]*?position:\s*static/);
    expect(style).toMatch(/#map-view-menu \.map-view-popover\s*\{[\s\S]*?display:\s*flex/);
  });
});
