const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const html = read('public/index.html');
const style = read('public/css/style.css');
const app = read('public/js/app.js');
const ros = read('public/js/ros-manager.js');
const testMode = read('public/js/test-mode.js');
const fleet = read('public/js/fleet-control.js');
const jog = read('public/js/jog-control.js');
const guides = read('public/js/usage-guides.js');
const authRoute = read('server/routes/auth.js');
const server = read('server.js');
const wsProxyTarget = read('server/ws-proxy-target.js');

describe('user-requested feature regression gate', () => {
  test('login works before optional initialization and starts in Korean', () => {
    expect(html).toContain('<html lang="ko">');
    expect(html).toContain('id="password-submit"');
    expect(html).toContain('maxlength="128"');
    expect(html).toContain('<span class="role-label">일반 사용자</span>');
    expect(html).toContain('<span class="role-label">엔지니어</span>');
    expect(app.indexOf('App.setupPasswordAuth();')).toBeLessThan(app.indexOf('App.init();'));
    expect(authRoute).toContain('password !== sharedPassword');
    expect(authRoute).toContain("role === 'engineer'");
  });

  test('engineer mode and MANUAL/AUTO behavior remain discoverable', () => {
    expect(app).toContain("const engineerTabs = ['tab-ssh'");
    expect(app).toContain("document.body.classList.toggle('role-engineer', isEngineer)");
    expect(html).toContain('MANUAL: Task를 직접 실행합니다.');
    expect(app).toContain("['operation-mode', () => OpMode.init()]");
    expect(app).toContain("if (!isManualRun && !OpMode.isAuto)");
    expect(app).toContain("Scheduler의 예약 Task를 자동 실행합니다.");
  });

  test('responsive layout covers control-room, laptop, tablet and mobile sizes', () => {
    [
      '@media (max-width: 1480px)',
      '@media (max-width: 1180px)',
      '@media (max-width: 980px)',
      '@media (max-width: 620px)',
      '@media (pointer: coarse)'
    ].forEach(contract => expect(style).toContain(contract));
    expect(html).toContain('css/style.css?v=20260806-stl-ulsan-jog');
  });

  test('simplified header retains connection, BMS, Test Mode and settings details', () => {
    [
      'btn-global-quick-task',
      'btn-connection-summary',
      'connection-popover',
      'btn-bms-detail',
      'bms-detail-modal',
      'btn-test-mode-menu',
      'test-mode-popover',
      'btn-hdr-more',
      'hdr-more-menu'
    ].forEach(id => expect(html).toContain(`id="${id}"`));
    expect(app).toContain("shortState = '수신'");
    expect(app).toContain('setupBmsDetails()');
  });

  test('every requested header settings tool remains loaded and wired', () => {
    const contracts = [
      ['btn-init-setup', 'InitSetup.init()'],
      ['btn-error-codes', 'ErrorCodeDB.init()'],
      ['btn-health-check', 'HealthCheck.init()'],
      ['btn-diagnostic', 'DiagnosticTree.init()'],
      ['btn-incident-report', 'IncidentReport.init()'],
      ['btn-alarm-settings', "getElementById('btn-alarm-settings')"],
      ['btn-event-log', "getElementById('btn-event-log')"],
      ['btn-audit-trail', "getElementById('btn-audit-trail')"],
      ['btn-session-export', "getElementById('btn-session-export')"],
      ['btn-session-import', "getElementById('btn-session-import')"]
    ];
    contracts.forEach(([id, binding]) => {
      expect(html).toContain(`id="${id}"`);
      expect(app).toContain(binding);
    });
  });

  test('Dashboard Connection Timeline stays removed', () => {
    expect(html).not.toContain('Connection Timeline');
    expect(html).not.toContain('conn-timeline-list');
    expect(app).not.toContain('ConnTimeline');
    expect(ros).not.toContain('ConnTimeline');
  });

  test('map layers default to Map and Robot with requested ROS topics', () => {
    expect(html).toMatch(/id="chk-map"\s+checked/);
    expect(html).toMatch(/id="chk-robot-pose"\s+checked/);
    expect(html).toMatch(/id="chk-lidar"(?![^>]*checked)/);
    expect(html).toMatch(/id="chk-mapping-path"(?![^>]*checked)/);
    [
      '/scan_1',
      '/scan_2',
      '/move_base/local_costmap/costmap',
      '/best_local_trajectories_nav',
      '/lio_sam/mapping/path',
      '/lio_sam/mapping/footprint'
    ].forEach(topic => expect(ros).toContain(topic));
  });

  test('map wheel, compact tool menus and non-covering View controls remain active', () => {
    expect(ros).toContain("canvas.addEventListener('wheel'");
    ['map-layer-menu', 'map-view-menu', 'map-robot-menu', 'map-mapping-menu']
      .forEach(id => expect(html).toContain(`id="${id}"`));
    expect(style).toMatch(/#map-view-menu \.map-view-popover\s*\{[\s\S]*?position:\s*static/);
    expect(style).toMatch(/#map-view-menu \.map-view-popover\s*\{[\s\S]*?display:\s*flex/);
  });

  test('Test Mode has startup recovery and a lightweight virtual Mapping environment', () => {
    expect(testMode).toContain('STARTUP_TIMEOUT_MS: 45000');
    expect(testMode).toContain('_startupAttempt');
    expect(testMode).toContain('showLoading(false)');
    expect(testMode).toContain('_mappingScanRays: 96');
    expect(testMode).toContain('_createVirtualMappingState');
    expect(testMode).toContain('_publishVirtualMappingProducts');
    expect(testMode).toContain('lastMappingSession');
    expect(testMode).toContain('savedNavMap');
    expect(testMode).toContain('saveActiveMap()');
  });

  test('Test Mode driving avoids black occupied map cells', () => {
    expect(testMode).toContain('_navigationClearance: 0.30');
    expect(testMode).toContain('_buildNavigationGrid');
    expect(testMode).toContain('_planNavigationPath');
    expect(testMode).toContain('_isPoseTraversable');
    expect(testMode).toContain('목적지가 검은 장애물과 너무 가깝습니다.');
    expect(ros).toContain('avoidObstacles: !p.noAvoid');
    expect(html).toContain('검은 장애물 회피');
  });

  test('Test Mode rosbridge cannot occupy real robot loopback tunnel addresses', () => {
    expect(server).toContain('const TEST_MODE_ROSBRIDGE_PORT = 19090');
    expect(server).toContain('waitForPort(TEST_MODE_ROSBRIDGE_PORT');
    expect(server).toContain('validateRosProxyTarget(target');
    expect(wsProxyTarget).toContain('const isTestModeRosbridgePort = isLocal && port === testModePort');
    expect(wsProxyTarget).toContain('if (!isRobotRosbridgePort && !isTestModeRosbridgePort)');
    expect(testMode).toContain('ROSBRIDGE_PORT: 19090');
    expect(testMode).toContain('slot.wsPort = this.ROSBRIDGE_PORT');
    expect(app).toContain("navigator.sendBeacon('/api/testmode/stop', '{}')");
    expect(app).toContain('Test Mode cleanup during logout failed');
    expect(server).toContain('owned: ownsRosMaster');
    expect(server).toContain("return { started: false, message: 'rosapi 시작 timeout' }");
    expect(server).toContain("return { started: false, message: 'rosbridge 시작 timeout' }");
    expect(server).toContain('stopTestModeProcess();');
  });

  test('Mapping lifecycle, unsaved exit and partial Mapping retention stay intact', () => {
    expect(ros).toContain("_publishRoutineMode('NAV'");
    expect(ros).toContain("this._openMappingSaveConfirm('SLAM')");
    expect(ros).toContain("this._openMappingSaveConfirm('LIFELONG')");
    expect(ros).toContain('this._startSlamTrail(false)');
    expect(ros).toContain('this._startSlamTrail(true)');
    expect(ros).toContain('mappingActive && this._isLayerEnabled');
    [
      'mapping-save-confirm-modal',
      'btn-mapping-save-yes',
      'btn-mapping-save-no',
      'btn-mapping-save-cancel'
    ].forEach(id => expect(html).toContain(`id="${id}"`));
  });

  test('Loop Closure acceptance remains visible to non-engineers', () => {
    expect(ros).toContain("namespace === 'loop_slam_edges'");
    expect(ros).toContain('_announceLoopClosure');
    expect(html).toContain('Loop Closure 성사!');
    expect(html).toContain('id="btn-loop-closure-confirm"');
  });

  test('mini-control selection, Ctrl+number Task preview and confirmation remain wired', () => {
    expect(html).toContain('id="btn-mini-control"');
    expect(fleet).toContain('_handleTaskShortcut(event');
    expect(fleet).toContain('_requestShortcutTask');
    expect(fleet).toContain('_confirmShortcutTask');
    expect(html).toContain('id="fleet-shortcut-task-modal"');
    expect(html).toContain('이 Task를 입력하시겠습니까?');
  });

  test('Jog shortcuts include safe charge ON and immediate OFF', () => {
    expect(jog).toContain("normalizedKey === 'o' || normalizedKey === 'f'");
    expect(jog).toContain("this._setChargeRelay(normalizedKey === 'o')");
    expect(jog).toContain('정말 충전을 시작하시겠습니까?');
    expect(jog).toContain('_chargeCommandPending');
    expect(html).toContain('충전: O=ON, F=OFF');
  });

  test('click-only guides cover every main page and retain balanced readable layout', () => {
    const tabIds = Array.from(html.matchAll(/class="tab-content(?: active)?" id="([^"]+)"/g))
      .map(match => match[1]);
    tabIds.forEach(id => expect(guides).toContain(`'${id}': {`));
    expect(guides).toContain("button.className = 'usage-guide-trigger'");
    expect(guides).toContain('globalShortcuts: [');
    expect(style).toContain('.usage-guide-sections');
    expect(style).toContain('.usage-guide-sections.single-secondary');
    expect(style).toMatch(/\.usage-guide-content\s*\{[\s\S]*?text-align:\s*left/);
  });
});
