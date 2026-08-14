const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadLab() {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'drive-simulation-lab.js'),
    'utf8'
  );
  const context = {
    App: { activeSlotIndex: 0, _userRole: 'engineer' },
    TestMode: { enabled: true, virtualRobots: new Map() },
    document: {
      getElementById: jest.fn(() => null),
      querySelectorAll: jest.fn(() => [])
    },
    localStorage: {
      getItem: jest.fn(() => null),
      setItem: jest.fn()
    },
    console
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.__DriveSimulationLab = DriveSimulationLab;`, context);
  return context.__DriveSimulationLab;
}

describe('Engineer Test Mode driving A/B simulation', () => {
  test('simulates a current and improved profile on the same S curve', () => {
    const lab = loadLab();
    const scenario = lab._scenario('s_curve');
    const current = lab.simulateProfile(lab._normalizeProfile({}), scenario);
    const improved = lab.simulateProfile(lab._recommendedFrom(current.profile), scenario);

    expect(current.trajectory.length).toBeGreaterThan(20);
    expect(improved.trajectory.length).toBeGreaterThan(20);
    expect(Number.isFinite(current.rmsCrossTrack)).toBe(true);
    expect(Number.isFinite(improved.score)).toBe(true);
    expect(current.collision).toBe(false);
    expect(improved.collision).toBe(false);
  });

  test('collision_detect_range changes the obstacle stopping margin', () => {
    const lab = loadLab();
    const scenario = lab._scenario('obstacle_stop');
    const shortRange = lab.simulateProfile(
      lab._normalizeProfile({ collisionDetectRange: 0.1 }),
      scenario
    );
    const longRange = lab.simulateProfile(
      lab._normalizeProfile({ collisionDetectRange: 0.6 }),
      scenario
    );

    expect(shortRange.expectedSafeStop).toBe(true);
    expect(longRange.expectedSafeStop).toBe(true);
    expect(longRange.stopClearance).toBeGreaterThan(shortRange.stopClearance);
  });

  test('passing distance completes a route earlier when passing is enabled', () => {
    const lab = loadLab();
    const scenario = lab._scenario('s_curve');
    const precise = lab.simulateProfile(
      lab._normalizeProfile({ passingFlag: false, xyGoalTolerance: 0.03 }),
      scenario
    );
    const passing = lab.simulateProfile(
      lab._normalizeProfile({ passingFlag: true, passingDist: 0.5 }),
      scenario
    );

    expect(passing.elapsed).toBeLessThan(precise.elapsed);
  });

  test('DD and QD produce distinct corner trajectories', () => {
    const lab = loadLab();
    const scenario = lab._scenario('corner');
    const dd = lab.simulateProfile(lab._normalizeProfile({ modelType: 0 }), scenario);
    const qd = lab.simulateProfile(lab._normalizeProfile({ modelType: 1 }), scenario);

    expect(dd.trajectory).not.toEqual(qd.trajectory);
    expect(dd.profile.modelType).toBe(0);
    expect(qd.profile.modelType).toBe(1);
  });

  test('engineer lab UI and script are present', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');

    expect(html).toContain('id="btn-drive-simulation-lab"');
    expect(html).toContain('id="drive-simulation-modal"');
    expect(html).toContain('id="btn-drive-apply-improved"');
    expect(html).toContain('js/drive-simulation-lab.js');
    expect(css).toContain('.drive-profile-columns');
  });
});
