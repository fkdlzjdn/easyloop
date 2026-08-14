/* exported DriveSimulationLab */
// Engineer-only A/B driving simulation for Test Mode.
// The lightweight controller mirrors the parameter relationships used by
// SR-AMR-Base Pure Planner without sending anything to a real robot.
// eslint-disable-next-line no-unused-vars -- classic-script global consumed by app.js/test-mode.js
const DriveSimulationLab = {
  STORAGE_KEY: 'easyloopDriveSimulationImprovedProfile',
  FIELD_DEFS: [
    { key: 'maxTransVel', label: '최대 선속도', unit: 'm/s', min: 0.05, max: 1.8, step: 0.05 },
    { key: 'maxTransAcc', label: '선가속도', unit: 'm/s²', min: 0.05, max: 3, step: 0.05 },
    { key: 'maxTransDeacc', label: '선감속도', unit: 'm/s²', min: 0.05, max: 3, step: 0.05 },
    { key: 'maxRotVel', label: '최대 각속도', unit: 'rad/s', min: 0.1, max: 1.8, step: 0.05 },
    { key: 'wpTolerance', label: 'Lookahead 기준', unit: 'm', min: 0.05, max: 2, step: 0.05 },
    { key: 'arrivingDistance', label: '감속 진입거리', unit: 'm', min: 0.1, max: 5, step: 0.1 },
    { key: 'responseTime', label: '응답 지연', unit: 's', min: 0, max: 5, step: 0.05 },
    { key: 'headingYaw', label: '회전 우선각', unit: 'rad', min: 0.1, max: 3.14, step: 0.05 },
    { key: 'passingDist', label: 'Passing 거리', unit: 'm', min: 0.01, max: 2, step: 0.01 },
    { key: 'collisionDetectRange', label: '충돌 감지거리', unit: 'm', min: 0, max: 2, step: 0.05 }
  ],
  initialized: false,
  currentProfile: null,
  improvedProfile: null,
  lastComparison: null,

  init() {
    if (this.initialized) return;
    const openButton = document.getElementById('btn-drive-simulation-lab');
    const modal = document.getElementById('drive-simulation-modal');
    if (!openButton || !modal) return;
    this.initialized = true;

    openButton.addEventListener('click', () => this.open());
    document.getElementById('btn-drive-simulation-close')
      ?.addEventListener('click', () => this.close());
    modal.addEventListener('click', event => {
      if (event.target === modal) this.close();
    });
    document.getElementById('btn-drive-load-current')
      ?.addEventListener('click', () => this.loadCurrentProfile(true));
    document.getElementById('btn-drive-recommend')
      ?.addEventListener('click', () => this.buildRecommendedProfile(true));
    document.getElementById('btn-drive-run-comparison')
      ?.addEventListener('click', () => this.runComparison());
    document.getElementById('btn-drive-apply-improved')
      ?.addEventListener('click', () => this.applyImprovedToTestMode());
    document.getElementById('btn-drive-clear-override')
      ?.addEventListener('click', () => this.clearTestModeOverride());
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && modal.classList.contains('show')) this.close();
    });

    this.refreshAvailability();
  },

  refreshAvailability() {
    const button = document.getElementById('btn-drive-simulation-lab');
    if (!button) return;
    const engineer = typeof App !== 'undefined' && App._userRole === 'engineer';
    const ready = engineer && typeof TestMode !== 'undefined'
      && TestMode.enabled && !TestMode._starting;
    button.disabled = !ready;
    button.title = !engineer
      ? '엔지니어 모드에서 사용할 수 있습니다'
      : (ready
        ? '현재 주행 설정과 개선 후보를 같은 조건으로 비교합니다'
        : 'Test Mode를 먼저 시작하세요');
  },

  open() {
    if (typeof App === 'undefined' || App._userRole !== 'engineer') {
      if (typeof App !== 'undefined') {
        App.toast?.('엔지니어 모드에서만 사용할 수 있습니다.', 'warning');
      }
      return false;
    }
    if (typeof TestMode === 'undefined' || !TestMode.enabled) {
      App.toast('Test Mode를 먼저 시작하세요.', 'warning');
      return false;
    }
    this.loadCurrentProfile(false);
    document.getElementById('drive-simulation-modal')?.classList.add('show');
    this._drawEmptyScenario();
    return true;
  },

  close() {
    document.getElementById('drive-simulation-modal')?.classList.remove('show');
  },

  _baseProfile() {
    const robot = TestMode.virtualRobots?.get(App.activeSlotIndex);
    if (robot?.currentAction?.profile) {
      document.getElementById('drive-current-source').textContent =
        `${robot.robotId} · 실행 중 Action`;
      return this._normalizeProfile(robot.currentAction.profile);
    }

    const action = { action_params: [] };
    const profile = typeof TestMode._buildTrajectoryProfile === 'function'
      ? TestMode._buildTrajectoryProfile(action, { action_type: 0x15 })
      : {};
    document.getElementById('drive-current-source').textContent =
      'SR-AMR-Base 기본 Action 설정';
    return this._normalizeProfile(profile);
  },

  _normalizeProfile(profile = {}) {
    return {
      maxTransVel: this._limit(profile.maxTransVel, 0.05, 1.8, 0.7),
      maxTransAcc: this._limit(profile.maxTransAcc, 0.05, 3, 0.3),
      maxTransDeacc: this._limit(profile.maxTransDeacc, 0.05, 3, 0.3),
      maxRotVel: this._limit(profile.maxRotVel, 0.1, 1.8, 0.6),
      maxRotAcc: this._limit(profile.maxRotAcc, 0.05, 3, 0.3),
      maxRotDeacc: this._limit(profile.maxRotDeacc, 0.05, 3, 0.3),
      minTransVel: this._limit(profile.minTransVel, 0, 0.5, 0.03),
      minRotVel: this._limit(profile.minRotVel, 0, 0.8, 0.03),
      xyGoalTolerance: this._limit(profile.xyGoalTolerance, 0.02, 1, 0.15),
      yawGoalTolerance: this._limit(profile.yawGoalTolerance, 0.01, Math.PI, 0.05),
      wpTolerance: this._limit(profile.wpTolerance, 0.05, 2, 0.5),
      arrivingDistance: this._limit(profile.arrivingDistance, 0.1, 5, 1),
      responseTime: this._limit(profile.responseTime, 0, 5, 0.6),
      headingYaw: this._limit(profile.headingYaw, 0.1, Math.PI, 0.8),
      driveGain: this._limit(profile.driveGain, 0.2, 4, 1.2),
      derivativeGain: this._limit(profile.derivativeGain, 0, 1, 0.08),
      passingDist: this._limit(profile.passingDist, 0.01, 2, 0.03),
      collisionDetectRange: this._limit(profile.collisionDetectRange, 0, 2, 0.15),
      passingFlag: Boolean(profile.passingFlag),
      modelType: [0, 1, 2].includes(Number(profile.modelType))
        ? Number(profile.modelType)
        : 0,
      plannerName: String(profile.plannerName || 'Pure'),
      controllerSource: String(profile.controllerSource || 'SR-AMR-Base')
    };
  },

  loadCurrentProfile(notify = false) {
    this.currentProfile = this._baseProfile();
    this._renderProfile('current', this.currentProfile);

    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(this.STORAGE_KEY) || 'null');
    } catch (_error) {
      saved = null;
    }
    this.improvedProfile = saved
      ? this._normalizeProfile({ ...this.currentProfile, ...saved })
      : this._recommendedFrom(this.currentProfile);
    this._renderProfile('improved', this.improvedProfile);
    this.lastComparison = null;
    const applyButton = document.getElementById('btn-drive-apply-improved');
    if (applyButton) applyButton.disabled = true;
    this._setVerdict('idle', '동일 조건 비교를 실행하면 현재 설정과 개선 후보의 차이를 확인할 수 있습니다.');
    if (notify) App.toast('현재 Test Mode Action 설정을 다시 읽었습니다.', 'success');
  },

  buildRecommendedProfile(notify = false) {
    this.currentProfile = this._readProfile('current');
    this.improvedProfile = this._recommendedFrom(this.currentProfile);
    this._renderProfile('improved', this.improvedProfile);
    if (notify) {
      App.toast('곡선 추종과 감속 안정성을 우선한 개선 후보를 구성했습니다.', 'success');
    }
  },

  _recommendedFrom(current) {
    return this._normalizeProfile({
      ...current,
      maxTransVel: Math.min(current.maxTransVel, 0.8),
      maxTransAcc: Math.min(current.maxTransAcc, 0.4),
      maxTransDeacc: Math.max(current.maxTransDeacc, current.maxTransAcc * 1.2, 0.4),
      maxRotVel: Math.max(0.65, Math.min(current.maxRotVel, 1.0)),
      maxRotAcc: Math.max(current.maxRotAcc, 0.35),
      maxRotDeacc: Math.max(current.maxRotDeacc, 0.4),
      wpTolerance: Math.max(0.35, Math.min(0.65, current.wpTolerance * 0.82)),
      arrivingDistance: Math.max(1.0, current.arrivingDistance),
      responseTime: Math.min(0.35, current.responseTime),
      headingYaw: Math.max(0.45, Math.min(0.7, current.headingYaw)),
      passingDist: Math.max(0.12, current.passingDist),
      collisionDetectRange: Math.max(0.3, current.collisionDetectRange),
      passingFlag: current.passingFlag
    });
  },

  _renderProfile(side, profile) {
    const container = document.getElementById(`drive-profile-${side}`);
    if (!container) return;
    container.innerHTML = '';
    this.FIELD_DEFS.forEach(definition => {
      const label = document.createElement('label');
      label.className = 'drive-profile-field';
      const caption = document.createElement('span');
      caption.textContent = `${definition.label} (${definition.unit})`;
      const input = document.createElement('input');
      input.type = 'number';
      input.min = String(definition.min);
      input.max = String(definition.max);
      input.step = String(definition.step);
      input.value = String(Number(profile[definition.key]).toFixed(
        definition.step < 0.05 ? 2 : 2
      ));
      input.dataset.profile = side;
      input.dataset.key = definition.key;
      label.append(caption, input);
      container.appendChild(label);
    });

    const modelLabel = document.createElement('label');
    modelLabel.className = 'drive-profile-field';
    const modelCaption = document.createElement('span');
    modelCaption.textContent = '구동 모델';
    const model = document.createElement('select');
    model.dataset.profile = side;
    model.dataset.key = 'modelType';
    [['0', 'DD'], ['1', 'QD'], ['2', 'TRAILER']].forEach(([value, text]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      option.selected = Number(profile.modelType) === Number(value);
      model.appendChild(option);
    });
    modelLabel.append(modelCaption, model);
    container.appendChild(modelLabel);

    const passLabel = document.createElement('label');
    passLabel.className = 'drive-profile-field toggle';
    const passing = document.createElement('input');
    passing.type = 'checkbox';
    passing.checked = Boolean(profile.passingFlag);
    passing.dataset.profile = side;
    passing.dataset.key = 'passingFlag';
    const passText = document.createElement('span');
    passText.textContent = 'Passing 사용';
    passLabel.append(passing, passText);
    container.appendChild(passLabel);
  },

  _readProfile(side) {
    const base = side === 'current' ? this.currentProfile : this.improvedProfile;
    const profile = { ...base };
    document.querySelectorAll(`[data-profile="${side}"]`).forEach(input => {
      if (input.dataset.key === 'passingFlag') {
        profile.passingFlag = input.checked;
      } else {
        profile[input.dataset.key] = Number(input.value);
      }
    });
    return this._normalizeProfile(profile);
  },

  runComparison() {
    try {
      this.currentProfile = this._readProfile('current');
      this.improvedProfile = this._readProfile('improved');
      const scenario = this._scenario(
        document.getElementById('drive-simulation-scenario')?.value || 's_curve'
      );
      const current = this.simulateProfile(this.currentProfile, scenario);
      const improved = this.simulateProfile(this.improvedProfile, scenario);
      this.lastComparison = { scenario, current, improved };
      this._drawComparison(this.lastComparison);
      this._renderMetrics(current, improved, scenario);
      this._renderVerdict(current, improved, scenario);
      try {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.improvedProfile));
      } catch (_error) {
        // A/B comparison still works when browser storage is unavailable.
      }
      const applyButton = document.getElementById('btn-drive-apply-improved');
      if (applyButton) applyButton.disabled = false;
      App.addEvent?.(
        'action',
        '[TestMode] 주행 A/B 비교 완료',
        `${scenario.name} · A ${current.score}점 / B ${improved.score}점`,
        improved.score >= current.score ? 'success' : 'info'
      );
      return this.lastComparison;
    } catch (error) {
      this._setVerdict('warning', error.message || '시뮬레이션을 실행할 수 없습니다.');
      App.toast(error.message || '시뮬레이션 실행 실패', 'error');
      return null;
    }
  },

  _scenario(kind) {
    if (kind === 'active_task') {
      const robot = TestMode.virtualRobots?.get(App.activeSlotIndex);
      const points = [
        robot?.pose,
        ...(robot?.plannedPath || []),
        robot?.currentAction?.navTarget,
        ...(robot?.currentAction?.navQueue || [])
      ].filter(point => Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y)));
      const unique = points.filter((point, index) => index === 0
        || Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) > 0.03);
      if (unique.length < 2) {
        throw new Error('현재 실행 중인 Task 경로가 없습니다. Task를 실행하거나 다른 시나리오를 선택하세요.');
      }
      return {
        id: kind,
        name: '현재 실행 Task 경로',
        route: unique.map(point => ({ x: Number(point.x), y: Number(point.y) })),
        obstacles: [],
        expectedStop: false
      };
    }
    const scenarios = {
      s_curve: {
        name: 'S 커브 추종',
        route: [[0, 0], [1, 0], [1.8, 0.75], [2.7, 0.85], [3.6, -0.75], [4.5, -0.8], [5.5, 0]],
        obstacles: []
      },
      corner: {
        name: '직각 코너',
        route: [[0, 0], [2.5, 0], [2.5, 2.3], [4.7, 2.3]],
        obstacles: []
      },
      slalom: {
        name: '장애물 슬라럼',
        route: [[0, 0], [1, 0], [1.7, 0.75], [2.5, 0.75], [3.2, -0.75], [4, -0.75], [4.8, 0], [5.8, 0]],
        obstacles: [
          { x: 1.9, y: 0, radius: 0.28 },
          { x: 3.5, y: 0, radius: 0.28 }
        ]
      },
      obstacle_stop: {
        name: '전방 장애물 안전정지',
        route: [[0, 0], [5.5, 0]],
        obstacles: [{ x: 4.1, y: 0, radius: 0.32 }],
        expectedStop: true
      }
    };
    const selected = scenarios[kind] || scenarios.s_curve;
    return {
      id: kind,
      name: selected.name,
      route: selected.route.map(([x, y]) => ({ x, y })),
      obstacles: selected.obstacles || [],
      expectedStop: Boolean(selected.expectedStop)
    };
  },

  simulateProfile(rawProfile, scenario) {
    const profile = this._normalizeProfile(rawProfile);
    const route = scenario.route.map(point => ({ x: Number(point.x), y: Number(point.y) }));
    if (route.length < 2) throw new Error('비교할 경로 점이 부족합니다.');
    const denseRoute = this._densifyRoute(route, 0.06);
    const startYaw = Math.atan2(route[1].y - route[0].y, route[1].x - route[0].x);
    const state = {
      x: route[0].x,
      y: route[0].y,
      yaw: startYaw,
      speed: 0,
      angularSpeed: 0,
      previousError: 0,
      previousAcceleration: 0,
      nearestIndex: 0,
      elapsed: 0
    };
    const dt = 0.05;
    const footprintRadius = 0.26;
    const trajectory = [{ x: state.x, y: state.y }];
    let distanceTravelled = 0;
    let crossTrackSquared = 0;
    let crossTrackMax = 0;
    let crossTrackSamples = 0;
    let minClearance = Infinity;
    let peakSpeed = 0;
    let peakAngularSpeed = 0;
    let jerkTotal = 0;
    let safetyStop = false;
    let collision = false;
    let completed = false;
    let stopClearance = Infinity;

    for (let iteration = 0; iteration < 2400; iteration += 1) {
      const final = route.at(-1);
      const finalDistance = Math.hypot(final.x - state.x, final.y - state.y);
      const completionTolerance = profile.passingFlag
        ? profile.passingDist
        : profile.xyGoalTolerance;
      if (finalDistance <= completionTolerance) {
        completed = true;
        break;
      }

      const nearest = this._nearestRoutePoint(
        state.x,
        state.y,
        denseRoute,
        state.nearestIndex
      );
      state.nearestIndex = nearest.index;
      const lookaheadDistance = Math.max(0.32 + state.speed, profile.wpTolerance + state.speed);
      const targetIndex = this._lookaheadIndex(denseRoute, nearest.index, lookaheadDistance);
      const target = denseRoute[targetIndex];
      const nextTarget = denseRoute[Math.min(denseRoute.length - 1, targetIndex + 8)];
      const pathYaw = Math.atan2(target.y - state.y, target.x - state.x);
      const nextPathYaw = Math.atan2(nextTarget.y - target.y, nextTarget.x - target.x);
      const curveError = Math.abs(this._normalizeAngle(nextPathYaw - pathYaw));
      const headingError = this._normalizeAngle(pathYaw - state.yaw);

      let desiredSpeed = profile.maxTransVel;
      if (curveError > 0.02) {
        desiredSpeed = Math.min(
          desiredSpeed,
          this._curveSpeedLimit(profile.maxTransVel, curveError)
        );
      }
      const stoppingDistance = state.speed * state.speed
        / (2 * Math.max(0.05, profile.maxTransDeacc))
        + state.speed * profile.responseTime;
      const arrivalThreshold = Math.max(profile.arrivingDistance, stoppingDistance);
      if (finalDistance < arrivalThreshold) {
        const ratio = Math.max(0, Math.min(1, finalDistance / arrivalThreshold));
        desiredSpeed = Math.min(
          desiredSpeed,
          profile.minTransVel + (profile.maxTransVel - profile.minTransVel) * ratio
        );
      }
      if (profile.modelType !== 1 && Math.abs(headingError) > profile.headingYaw) {
        desiredSpeed = 0;
      } else if (profile.modelType !== 1 && Math.abs(headingError) > 0.01) {
        desiredSpeed = Math.min(
          desiredSpeed,
          profile.maxTransVel * Math.min(1, 0.1 + Math.exp(
            -(profile.maxTransVel * profile.maxTransVel + 0.5) * Math.abs(headingError)
          ))
        );
      }

      const obstacleState = this._obstacleState(
        state,
        pathYaw,
        scenario.obstacles,
        footprintRadius
      );
      minClearance = Math.min(minClearance, obstacleState.minimumClearance);
      if (obstacleState.minimumClearance <= 0) {
        collision = true;
        break;
      }
      if (obstacleState.forwardClearance <= profile.collisionDetectRange) {
        safetyStop = true;
        stopClearance = obstacleState.forwardClearance;
        break;
      }

      const previousSpeed = state.speed;
      state.speed = this._approach(
        state.speed,
        desiredSpeed,
        profile.maxTransAcc,
        profile.maxTransDeacc,
        dt
      );
      const acceleration = (state.speed - previousSpeed) / dt;
      jerkTotal += Math.abs(acceleration - state.previousAcceleration);
      state.previousAcceleration = acceleration;

      const derivative = (headingError - state.previousError) / dt;
      let desiredAngular = profile.modelType === 1
        ? 0
        : profile.driveGain * headingError
          + profile.derivativeGain * Math.max(-2, Math.min(2, derivative));
      desiredAngular = Math.max(-profile.maxRotVel, Math.min(profile.maxRotVel, desiredAngular));
      state.angularSpeed = this._approach(
        state.angularSpeed,
        desiredAngular,
        profile.maxRotAcc,
        profile.maxRotDeacc,
        dt
      );
      state.previousError = headingError;

      const previousX = state.x;
      const previousY = state.y;
      if (profile.modelType === 1) {
        state.x += Math.cos(pathYaw) * state.speed * dt;
        state.y += Math.sin(pathYaw) * state.speed * dt;
        state.yaw = pathYaw;
      } else {
        state.yaw = this._normalizeAngle(state.yaw + state.angularSpeed * dt);
        state.x += Math.cos(state.yaw) * state.speed * dt;
        state.y += Math.sin(state.yaw) * state.speed * dt;
      }
      distanceTravelled += Math.hypot(state.x - previousX, state.y - previousY);
      state.elapsed += dt;
      peakSpeed = Math.max(peakSpeed, Math.abs(state.speed));
      peakAngularSpeed = Math.max(peakAngularSpeed, Math.abs(state.angularSpeed));

      const tracked = this._nearestRoutePoint(state.x, state.y, denseRoute, state.nearestIndex);
      const crossTrack = tracked.distance;
      crossTrackSquared += crossTrack * crossTrack;
      crossTrackMax = Math.max(crossTrackMax, crossTrack);
      crossTrackSamples += 1;
      if (iteration % 2 === 0) trajectory.push({ x: state.x, y: state.y });
    }

    const rmsCrossTrack = Math.sqrt(crossTrackSquared / Math.max(1, crossTrackSamples));
    const expectedSafeStop = scenario.expectedStop && safetyStop && !collision;
    const normalSuccess = !scenario.expectedStop && completed && !collision && !safetyStop;
    const score = this._scoreResult({
      completed,
      collision,
      safetyStop,
      expectedSafeStop,
      rmsCrossTrack,
      crossTrackMax,
      elapsed: state.elapsed,
      jerkMean: jerkTotal / Math.max(1, crossTrackSamples),
      stopClearance
    }, scenario);

    return {
      profile,
      trajectory,
      completed,
      collision,
      safetyStop,
      expectedSafeStop,
      successful: normalSuccess || expectedSafeStop,
      elapsed: state.elapsed,
      distanceTravelled,
      rmsCrossTrack,
      crossTrackMax,
      minClearance,
      stopClearance,
      peakSpeed,
      peakAngularSpeed,
      jerkMean: jerkTotal / Math.max(1, crossTrackSamples),
      score
    };
  },

  _scoreResult(result, scenario) {
    if (result.collision) return 0;
    let score = 0;
    if (scenario.expectedStop) {
      score += result.expectedSafeStop ? 55 : 0;
      if (result.expectedSafeStop) {
        score += Math.max(0, 15 - Math.abs(result.stopClearance - 0.35) * 25);
      }
    } else {
      score += result.completed ? 55 : 0;
      if (result.safetyStop) score -= 15;
    }
    score += Math.max(0, 20 - result.rmsCrossTrack * 80);
    score += Math.max(0, 12 - result.crossTrackMax * 25);
    score += Math.max(0, 8 - result.jerkMean * 0.04);
    score += Math.max(0, 5 - result.elapsed * 0.12);
    return Math.max(0, Math.min(100, Math.round(score)));
  },

  _densifyRoute(route, spacing) {
    const result = [{ ...route[0] }];
    for (let index = 1; index < route.length; index += 1) {
      const from = route[index - 1];
      const to = route[index];
      const distance = Math.hypot(to.x - from.x, to.y - from.y);
      const count = Math.max(1, Math.ceil(distance / spacing));
      for (let step = 1; step <= count; step += 1) {
        const ratio = step / count;
        result.push({
          x: from.x + (to.x - from.x) * ratio,
          y: from.y + (to.y - from.y) * ratio
        });
      }
    }
    return result;
  },

  _nearestRoutePoint(x, y, route, startIndex = 0) {
    let bestIndex = Math.max(0, Math.min(route.length - 1, startIndex - 8));
    let bestDistance = Infinity;
    const end = Math.min(route.length, Math.max(startIndex + 80, 80));
    for (let index = bestIndex; index < end; index += 1) {
      const distance = Math.hypot(route[index].x - x, route[index].y - y);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    return { index: bestIndex, distance: bestDistance };
  },

  _lookaheadIndex(route, startIndex, distance) {
    let accumulated = 0;
    for (let index = startIndex + 1; index < route.length; index += 1) {
      accumulated += Math.hypot(
        route[index].x - route[index - 1].x,
        route[index].y - route[index - 1].y
      );
      if (accumulated >= distance) return index;
    }
    return route.length - 1;
  },

  _obstacleState(state, travelYaw, obstacles, footprintRadius) {
    let minimumClearance = Infinity;
    let forwardClearance = Infinity;
    obstacles.forEach(obstacle => {
      const dx = obstacle.x - state.x;
      const dy = obstacle.y - state.y;
      const distance = Math.hypot(dx, dy);
      const combinedRadius = Number(obstacle.radius || 0) + footprintRadius;
      minimumClearance = Math.min(minimumClearance, distance - combinedRadius);
      const forward = Math.cos(travelYaw) * dx + Math.sin(travelYaw) * dy;
      const lateral = Math.abs(-Math.sin(travelYaw) * dx + Math.cos(travelYaw) * dy);
      if (forward >= 0 && lateral <= combinedRadius) {
        forwardClearance = Math.min(forwardClearance, forward - combinedRadius);
      }
    });
    return { minimumClearance, forwardClearance };
  },

  _curveSpeedLimit(maximum, headingError) {
    const calculated = maximum
      * (0.05 + Math.exp(-(maximum * maximum + 0.5) * 3 * Math.abs(headingError)));
    return Math.max(maximum * 0.18, Math.min(maximum, calculated));
  },

  _approach(current, target, acceleration, deceleration, dt) {
    const increasing = Math.abs(target) > Math.abs(current);
    const rate = Math.max(0.001, increasing ? acceleration : deceleration);
    const delta = target - current;
    return current + Math.sign(delta) * Math.min(Math.abs(delta), rate * dt);
  },

  _normalizeAngle(value) {
    let angle = Number(value) || 0;
    while (angle > Math.PI) angle -= Math.PI * 2;
    while (angle < -Math.PI) angle += Math.PI * 2;
    return angle;
  },

  _limit(value, minimum, maximum, fallback) {
    const number = Number(value);
    return Math.max(minimum, Math.min(maximum, Number.isFinite(number) ? number : fallback));
  },

  _drawEmptyScenario() {
    try {
      const scenario = this._scenario(
        document.getElementById('drive-simulation-scenario')?.value || 's_curve'
      );
      this._drawComparison({ scenario, current: null, improved: null });
    } catch (_error) {
      // Active Task can legitimately be unavailable before a Task starts.
    }
  },

  _drawComparison({ scenario, current, improved }) {
    const canvas = document.getElementById('drive-simulation-canvas');
    const context = canvas?.getContext?.('2d');
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const allPoints = [
      ...scenario.route,
      ...(current?.trajectory || []),
      ...(improved?.trajectory || []),
      ...scenario.obstacles.map(obstacle => ({ x: obstacle.x, y: obstacle.y }))
    ];
    const xs = allPoints.map(point => point.x);
    const ys = allPoints.map(point => point.y);
    const minX = Math.min(...xs) - 0.7;
    const maxX = Math.max(...xs) + 0.7;
    const minY = Math.min(...ys) - 0.7;
    const maxY = Math.max(...ys) + 0.7;
    const scale = Math.min(
      (canvas.width - 70) / Math.max(1, maxX - minX),
      (canvas.height - 50) / Math.max(1, maxY - minY)
    );
    const toCanvas = point => ({
      x: 35 + (point.x - minX) * scale,
      y: canvas.height - 25 - (point.y - minY) * scale
    });

    context.strokeStyle = 'rgba(100, 116, 139, 0.13)';
    context.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 40) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, canvas.height);
      context.stroke();
    }
    for (let y = 0; y < canvas.height; y += 40) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(canvas.width, y);
      context.stroke();
    }

    this._drawPath(context, scenario.route.map(toCanvas), '#64748b', 2, [7, 6]);
    scenario.obstacles.forEach(obstacle => {
      const center = toCanvas(obstacle);
      context.beginPath();
      context.arc(center.x, center.y, obstacle.radius * scale, 0, Math.PI * 2);
      context.fillStyle = 'rgba(239, 68, 68, 0.68)';
      context.fill();
      context.strokeStyle = '#fca5a5';
      context.stroke();
    });
    if (current) {
      this._drawPath(context, current.trajectory.map(toCanvas), '#e2e8f0', 3, []);
    }
    if (improved) {
      this._drawPath(context, improved.trajectory.map(toCanvas), '#3b82f6', 3, []);
    }
  },

  _drawPath(context, points, color, width, dash) {
    if (points.length < 2) return;
    context.save();
    context.strokeStyle = color;
    context.lineWidth = width;
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.setLineDash(dash);
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    points.slice(1).forEach(point => context.lineTo(point.x, point.y));
    context.stroke();
    context.restore();
  },

  _renderMetrics(current, improved, scenario) {
    const body = document.getElementById('drive-simulation-metrics');
    if (!body) return;
    const status = result => {
      if (result.collision) return '충돌';
      if (result.expectedSafeStop) return '안전정지';
      if (result.safetyStop) return '조기 정지';
      return result.completed ? '완료' : '시간 초과';
    };
    const number = (value, unit, digits = 2) =>
      Number.isFinite(value) ? `${value.toFixed(digits)} ${unit}` : '—';
    const rows = [
      ['결과', status(current), status(improved), scenario.expectedStop ? '충돌 전 안전정지' : '경로 완주'],
      ['종합 점수', `${current.score}점`, `${improved.score}점`, '안전·추종·승차감 종합'],
      ['소요 시간', number(current.elapsed, 's', 1), number(improved.elapsed, 's', 1), '낮을수록 빠름'],
      ['RMS 경로 이탈', number(current.rmsCrossTrack, 'm'), number(improved.rmsCrossTrack, 'm'), '낮을수록 정확'],
      ['최대 경로 이탈', number(current.crossTrackMax, 'm'), number(improved.crossTrackMax, 'm'), '낮을수록 안정'],
      ['최소 장애물 여유', number(current.minClearance, 'm'), number(improved.minClearance, 'm'), '0m 이하는 접촉'],
      ['속도 변화량', number(current.jerkMean, 'Δa'), number(improved.jerkMean, 'Δa'), '낮을수록 부드러움'],
      ['최고 선속도', number(current.peakSpeed, 'm/s'), number(improved.peakSpeed, 'm/s'), '설정 제한 확인'],
      ['최고 각속도', number(current.peakAngularSpeed, 'rad/s'), number(improved.peakAngularSpeed, 'rad/s'), '회전 응답 확인']
    ];
    body.innerHTML = '';
    rows.forEach(row => {
      const tr = document.createElement('tr');
      row.forEach(value => {
        const td = document.createElement('td');
        td.textContent = value;
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
  },

  _renderVerdict(current, improved, scenario) {
    const delta = improved.score - current.score;
    const safetyText = scenario.expectedStop
      ? `A 정지여유 ${this._formatDistance(current.stopClearance)}, B ${this._formatDistance(improved.stopClearance)}`
      : `A 최대이탈 ${current.crossTrackMax.toFixed(2)}m, B ${improved.crossTrackMax.toFixed(2)}m`;
    if (delta >= 3) {
      this._setVerdict(
        'better',
        `개선 후보가 ${delta}점 높습니다. ${safetyText}. 실제 적용 전 Test Mode Task로 한 번 더 재현하세요.`
      );
    } else if (delta <= -3) {
      this._setVerdict(
        'warning',
        `개선 후보가 현재 설정보다 ${Math.abs(delta)}점 낮습니다. ${safetyText}. 값을 조정해 다시 비교하세요.`
      );
    } else {
      this._setVerdict(
        'idle',
        `두 설정의 종합 차이가 작습니다(${delta >= 0 ? '+' : ''}${delta}점). ${safetyText}.`
      );
    }
  },

  _formatDistance(value) {
    return Number.isFinite(value) ? `${value.toFixed(2)}m` : '—';
  },

  _setVerdict(type, message) {
    const verdict = document.getElementById('drive-simulation-verdict');
    if (!verdict) return;
    verdict.className = `drive-simulation-verdict ${type}`;
    verdict.textContent = message;
  },

  applyImprovedToTestMode() {
    if (!this.lastComparison || !TestMode.enabled) {
      App.toast('먼저 A/B 비교를 실행하세요.', 'warning');
      return false;
    }
    this.improvedProfile = this._readProfile('improved');
    TestMode.setDriveSimulationOverride?.(this.improvedProfile);
    this._updateGuard(true);
    App.toast('개선 후보를 Test Mode에만 임시 적용했습니다.', 'success');
    return true;
  },

  clearTestModeOverride() {
    TestMode.setDriveSimulationOverride?.(null);
    this._updateGuard(false);
    App.toast('Test Mode가 Action의 현재 설정을 사용합니다.', 'info');
  },

  _updateGuard(applied) {
    const guard = document.getElementById('drive-simulation-guard');
    if (!guard) return;
    guard.classList.toggle('applied', Boolean(applied));
    guard.textContent = applied
      ? '개선 후보가 Test Mode의 다음 주행 Action에 임시 적용 중입니다. 실제 로봇에는 반영되지 않습니다.'
      : '가상 환경에서만 계산합니다. 실제 로봇 파라미터에는 반영되지 않습니다.';
  }
};
