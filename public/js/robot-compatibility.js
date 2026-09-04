// Runtime ROS interface discovery for the four supported AMR repository lineages.
// Git lineage and ROBOT_MODEL are presentation hints. Only verified live graph
// endpoints/types are allowed to select a control adapter.
const RobotCompatibility = {
  DISCOVERY_TIMEOUT_MS: 2500,
  TUNNEL_DISCOVERY_TIMEOUT_MS: 6000,
  PROFILE_SCHEMA_VERSION: 3,
  STL_ULSAN_MODELS: new Set(['stl1000w', 'stl1500w']),

  PROJECT_GENERATIONS: [
    {
      id: 'legacy',
      label: '1세대 · Legacy scorpion_ros',
      protocolHint: 'ros1_legacy',
      projects: [
        'sr1000_wia', 'sr300_adas', 'sr300_hydrogen', 'sr300_wia', 'sr5c_ch',
        'sr5c_us', 'sr5_ams', 'sr5_dg', 'sr5_jp', 'sr5_ls', 'sr5_smic',
        'sr5_us', 'sr7_us'
      ]
    },
    {
      id: 'core_submodule',
      label: '2세대 · Core submodule ROS1',
      protocolHint: 'ros1_legacy',
      projects: [
        'forklift_develop', 'sr1_fulfillment', 'sr1_icbp', 'sr1_jusung', 'sr1_sds',
        'sr1_tfs', 'sr1_uni', 'sr3_dilli', 'sr3_hexagon', 'sr3_kbia', 'sr3_lse',
        'sr3_lse_v2', 'sr3_modex', 'sr3_posan', 'sr3_sps', 'sr3_yieng', 'sr5_bma',
        'sr5_jusung', 'sr5_kia', 'sr5_stator', 'sr5_us_bma', 'sr7_guyoung',
        'sr7_hybrid', 'stl_ulsan'
      ]
    },
    {
      id: 'spx_ros1',
      label: '3세대 · SPX ROS1',
      protocolHint: 'ros1_spx',
      projects: ['sl3000_mspe', 'tt400_vri', 'template_repository', 'SR-AMR-Base']
    },
    {
      id: 'spx_ros2',
      label: '4세대 · SPX ROS2 Jazzy',
      protocolHint: 'ros2_spx',
      projects: ['SR-AMR-Base2']
    }
  ],

  normalizeRobotModel(model) {
    return String(model || '').trim().toLowerCase();
  },

  isStlUlsanModel(model) {
    return this.STL_ULSAN_MODELS.has(this.normalizeRobotModel(model));
  },

  projectGeneration(project) {
    const normalized = String(project || '').trim().toLowerCase();
    return this.PROJECT_GENERATIONS.find(generation =>
      generation.projects.some(item => item.toLowerCase() === normalized)
    ) || null;
  },

  _discoveryTimeout(slot) {
    return slot?.tunnelMode
      ? this.TUNNEL_DISCOVERY_TIMEOUT_MS
      : this.DISCOVERY_TIMEOUT_MS;
  },

  _unavailableCapability(reason = 'ROS graph 검증 전') {
    return { verified: false, protocol: null, reason };
  },

  _defaultProfile(slot = {}, reason = 'ROS graph 검증 전') {
    const model = slot.robotModel || '';
    const project = slot.projectHint || (this.isStlUlsanModel(model) ? 'stl_ulsan' : null);
    const lineage = this.projectGeneration(project);
    const unavailable = () => this._unavailableCapability(reason);
    const map = {
      ...unavailable(),
      topic: null,
      topicType: null,
      mappingTopic: null,
      mappingTopicType: null,
      mappingTopicCandidates: [],
      staticService: null,
      staticType: null,
      baseName: 'map',
      directory: '/home/syscon/ROS_DB/map',
      saveService: null,
      saveType: null,
      saveUsesName: false,
      poseGraphSaveService: null,
      poseGraphSaveType: null,
      reloadService: null,
      reloadType: null,
      amclChangeService: null,
      amclChangeType: null,
      compression: 'png',
      managesRosNodes: false
    };
    const lift = {
      ...unavailable(),
      interface: 'none',
      topic: null,
      topicType: null,
      service: null,
      serviceType: null,
      cancelService: null,
      cancelType: null,
      cancelArgs: null,
      feedbackTopic: null,
      feedbackType: null,
      commands: null
    };
    const turntable = {
      ...unavailable(),
      enabled: false,
      argCount: 0,
      asyncModeArg: false,
      service: null,
      serviceType: null,
      cancelService: null,
      cancelType: null,
      feedbackTopic: null,
      feedbackType: null,
      syncService: null,
      syncType: null
    };
    const task = {
      ...unavailable(),
      variant: null,
      adapters: {},
      actionCatalog: {
        attempted: false,
        verified: false,
        service: null,
        serviceType: null,
        types: [],
        actions: [],
        reason: '등록 Action 목록 확인 전'
      },
      goalName: null,
      goalType: null,
      pauseName: null,
      pauseType: null,
      resumeName: null,
      resumeType: null,
      cancelName: null,
      cancelType: null,
      feedbackName: null,
      feedbackType: null,
      resultName: null,
      resultType: null,
      stateName: null,
      stateType: null
    };
    const mode = {
      ...unavailable(),
      commandInterface: null,
      commandName: null,
      commandType: null,
      statusName: null,
      statusType: null
    };
    const chassis = {
      ...unavailable(),
      drive: unavailable(),
      conveyor: unavailable(),
      charge: unavailable(),
      driveModel: {
        attempted: false,
        verified: false,
        kind: null,
        actionModelType: null,
        parameter: null,
        reason: '차상 model_type 확인 전'
      }
    };
    const monitoring = { ...unavailable(), topics: {} };
    return {
      schemaVersion: this.PROFILE_SCHEMA_VERSION,
      id: 'unverified',
      project,
      lineage: lineage ? { id: lineage.id, label: lineage.label } : null,
      model,
      discovered: false,
      controlReady: false,
      reason,
      transport: {
        kind: 'rosbridge',
        available: false,
        rosMajor: null,
        protocol: null,
        reason
      },
      evidence: { services: [], topics: [], serviceTypes: {}, topicTypes: {} },
      topics: [],
      services: [],
      serviceTypes: {},
      topicTypes: {},
      capabilities: { task, mode, map, lift, turntable, chassis, monitoring },
      task,
      mapping: mode,
      map,
      lift,
      chassis,
      monitoring,
      actions: { turntable }
    };
  },

  get(slot) {
    return slot?.compatibilityProfile || this._defaultProfile(slot);
  },

  clear(slot) {
    if (!slot) return;
    slot.compatibilityDiscoveryToken = (slot.compatibilityDiscoveryToken || 0) + 1;
    delete slot.compatibilityProfile;
    delete slot.compatibilityPromise;
    delete slot.taskInterface;
    delete slot.taskInterfaceModeResolved;
  },

  async discover(slot, options = {}) {
    if (!slot?.ros || !slot.robotId) {
      const profile = this._defaultProfile(slot, 'ROS 연결 또는 RID가 없어 graph를 검증할 수 없습니다.');
      if (slot) slot.compatibilityProfile = profile;
      return profile;
    }
    if (!options.force && slot.compatibilityProfile?.discovered) return slot.compatibilityProfile;
    if (!options.force && slot.compatibilityPromise) return slot.compatibilityPromise;

    const ros = slot.ros;
    const previousProfile = slot.compatibilityProfile;
    const token = (slot.compatibilityDiscoveryToken || 0) + 1;
    slot.compatibilityDiscoveryToken = token;
    const promise = this._discover(slot)
      .then(profile => {
        if (slot.ros !== ros || slot.compatibilityDiscoveryToken !== token) {
          return this._defaultProfile(slot, '새 연결이 시작되어 이전 graph 응답을 폐기했습니다.');
        }
        slot.compatibilityProfile = profile;
        this._notifyProfile(slot, profile);
        return profile;
      })
      .catch(error => {
        const reason = `ROS graph discovery 실패: ${error?.message || error}`;
        console.warn(`[Compatibility] ${slot.robotId} ${reason}`);
        // A forced refresh can time out while map/camera traffic occupies the
        // shared rosbridge socket. On the same ROS connection, keep the last
        // fully verified contract instead of disabling an already valid Jog.
        if (previousProfile?.discovered && slot.ros === ros
            && slot.compatibilityDiscoveryToken === token) {
          const cachedProfile = {
            ...previousProfile,
            discoveryWarning: reason,
            lastDiscoveryFailureAt: Date.now()
          };
          slot.compatibilityProfile = cachedProfile;
          this._notifyProfile(slot, cachedProfile);
          return cachedProfile;
        }
        const profile = this._defaultProfile(slot, reason);
        if (slot.ros === ros && slot.compatibilityDiscoveryToken === token) {
          slot.compatibilityProfile = profile;
          this._notifyProfile(slot, profile);
        }
        return profile;
      })
      .finally(() => {
        if (slot.compatibilityPromise === promise) delete slot.compatibilityPromise;
      });
    slot.compatibilityPromise = promise;
    return promise;
  },

  _isRelevantService(name, ns) {
    return name.startsWith(`${ns}/TARU/`)
      || name.startsWith(`${ns}/spx/`)
      || name.startsWith(`${ns}/Lift/`)
      || name.startsWith(`${ns}/Turntable/`)
      || name === `${ns}/save_map`
      || name === `${ns}/change_map`
      || name === `${ns}/amcl/change_map`
      || name === `${ns}/static_map`
      || name === `${ns}/slam_toolbox/serialize_map`
      || name === '/slam_toolbox/serialize_map'
      || name === `${ns}/Conv/cmd`
      || name === `${ns}/motor_reset`
      || name === `${ns}/Lift/motor_reset`
      || name === `${ns}/get_actions_info`
      || name === `${ns}/TARU/get_actions_info`
      || name === `${ns}/spx/task/actions/info`
      || name === '/spx/task/actions/info'
      || name.includes('charge_relay')
      || name.endsWith('/io/set/auto_charge')
      || name.endsWith('/set_charging_switch');
  },

  _isRelevantTopic(name, ns) {
    return name.startsWith(`${ns}/TARU/`)
      || name.startsWith(`/dt/ros/task/${ns.slice(1)}/`)
      || name.startsWith(`${ns}/spx/`)
      || name.startsWith(`${ns}/Lift/`)
      || name.startsWith(`${ns}/Turntable/`)
      || name === `${ns}/sp_routine`
      || name === `${ns}/spcore/MODE`
      || name === `${ns}/map`
      || name === `${ns}/slam_toolbox/map`
      || name === '/map'
      || name === `${ns}/cmd_vel`
      || name === `${ns}/Conv/cmd`
      || name === `${ns}/bms`
      || name === `${ns}/robot_state`
      || name === `${ns}/motor_status`
      || name === `${ns}/odom`
      || name === `${ns}/io/select`
      || name === `${ns}/emergency_sensor`
      || name === `${ns}/sto_stop`
      || name === `${ns}/io/lidar_field`
      || name === `${ns}/io/break_released`
      || name === `${ns}/taru_state`
      || name.includes('charge_relay');
  },

  async _discover(slot) {
    const timeout = this._discoveryTimeout(slot);
    const [servicesSettled, topicsSettled] = await Promise.allSettled([
      this._rosapi(slot.ros, '/rosapi/services', 'rosapi/Services', {}, timeout),
      this._rosapi(slot.ros, '/rosapi/topics', 'rosapi/Topics', {}, timeout)
    ]);
    const warnings = [];
    const servicesResult = servicesSettled.status === 'fulfilled' ? servicesSettled.value : null;
    const topicsResult = topicsSettled.status === 'fulfilled' ? topicsSettled.value : null;
    if (servicesSettled.status === 'rejected') {
      warnings.push(`services: ${servicesSettled.reason?.message || servicesSettled.reason}`);
    } else if (!Array.isArray(servicesResult?.services)) {
      warnings.push('services: 응답 형식 오류');
    }
    if (topicsSettled.status === 'rejected') {
      warnings.push(`topics: ${topicsSettled.reason?.message || topicsSettled.reason}`);
    } else if (!Array.isArray(topicsResult?.topics)) {
      warnings.push('topics: 응답 형식 오류');
    }
    if (!Array.isArray(servicesResult?.services) && !Array.isArray(topicsResult?.topics)) {
      throw new Error(warnings.join(', ') || 'rosapi services/topics 조회 실패');
    }
    const services = Array.from(Array.isArray(servicesResult?.services) ? servicesResult.services : []);
    const topics = Array.from(Array.isArray(topicsResult?.topics) ? topicsResult.topics : []);
    const rid = String(slot.robotId).replace(/^\//, '');
    const ns = `/${rid}`;
    const serviceNames = services.filter(name => this._isRelevantService(name, ns));
    const topicNames = topics.filter(name => this._isRelevantTopic(name, ns));
    const [serviceEntries, topicEntries] = await Promise.all([
      Promise.all(serviceNames.map(name => this._lookupType(
        slot.ros, '/rosapi/service_type', 'rosapi/ServiceType', { service: name }, name, timeout
      ))),
      Promise.all(topicNames.map(name => this._lookupType(
        slot.ros, '/rosapi/topic_type', 'rosapi/TopicType', { topic: name }, name, timeout
      )))
    ]);
    const serviceTypes = Object.fromEntries(serviceEntries);
    const topicTypes = Object.fromEntries(topicEntries);
    const profile = this._buildProfile(slot, services, topics, serviceTypes, topicTypes);
    profile.discoveryWarnings = warnings;
    if (warnings.length) {
      profile.evidence.graphWarnings = [...warnings];
      console.warn(`[Compatibility] ${slot.robotId} partial graph: ${warnings.join(', ')}`);
    }
    await Promise.all([
      this._discoverActionCatalog(slot, profile, timeout),
      this._discoverDriveModel(slot, profile)
    ]);
    console.log(`[Compatibility] ${slot.robotId}: ${profile.id}`, {
      transport: profile.transport.protocol,
      task: profile.task.protocol,
      mode: profile.mapping.protocol,
      map: profile.map.protocol,
      lift: profile.lift.protocol,
      turntable: profile.actions.turntable.protocol
    });
    return profile;
  },

  _notifyProfile(slot, profile) {
    if (typeof document === 'undefined' || typeof document.dispatchEvent !== 'function'
        || typeof CustomEvent === 'undefined') return;
    document.dispatchEvent(new CustomEvent('amr:compatibility-updated', {
      detail: { robotId: slot?.robotId || '', profile }
    }));
  },

  _actionCatalogCandidates(slot, profile) {
    const rid = String(slot?.robotId || '').replace(/^\//, '');
    const ns = `/${rid}`;
    const native = [
      `${ns}/spx/task/actions/info`,
      '/spx/task/actions/info'
    ];
    const legacy = [
      `${ns}/get_actions_info`,
      `${ns}/TARU/get_actions_info`
    ];
    return profile?.task?.protocol === 'ros1_legacy'
      ? [...legacy, ...native]
      : [...native, ...legacy];
  },

  async _discoverActionCatalog(slot, profile, timeout) {
    const catalog = {
      attempted: true,
      verified: false,
      service: null,
      serviceType: null,
      types: [],
      actions: [],
      reason: '등록 Action 조회 service/type이 ROS graph에서 검증되지 않았습니다.'
    };
    profile.task.actionCatalog = catalog;
    if (!profile.task?.verified) {
      catalog.reason = profile.task?.reason || 'Task endpoint/type 미검증';
      return catalog;
    }
    const allowedTypes = [
      'sp_task/ActionInfo_srv',
      'spx_task_msgs/GetActionsInfo',
      'spx_task_msgs/srv/GetActionsInfo'
    ];
    const endpoint = this._actionCatalogCandidates(slot, profile)
      .map(name => ({ name, type: profile.serviceTypes?.[name] || '' }))
      .find(item => this._matchesType(item.type, allowedTypes));
    if (!endpoint) return catalog;

    catalog.service = endpoint.name;
    catalog.serviceType = endpoint.type;
    try {
      const response = await this._rosapi(
        slot.ros, endpoint.name, endpoint.type, {}, Math.min(timeout, 2500)
      );
      if (response?.success === false) {
        throw new Error(response.message || 'scheduler가 ActionInfo 조회를 거부했습니다.');
      }
      const raw = response?.actions || response?.data || response?.datas;
      if (!Array.isArray(raw)) throw new Error('ActionInfo 배열이 없습니다.');
      const actions = raw
        .map(item => ({
          name: String(item?.name || '').trim(),
          type: Number(item?.type),
          key: String(item?.key || '').trim()
        }))
        .filter(item => Number.isInteger(item.type) && item.type > 0);
      catalog.verified = true;
      catalog.actions = actions;
      catalog.types = Array.from(new Set(actions.map(item => item.type))).sort((a, b) => a - b);
      catalog.reason = actions.length
        ? ''
        : 'Task scheduler에 등록된 Action plugin이 없습니다.';
    } catch (error) {
      catalog.reason = `등록 Action 자동감지 실패: ${error?.message || error}`;
    }
    return catalog;
  },

  _parseRosParamValue(value) {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      return trimmed.replace(/^['"]|['"]$/g, '');
    }
  },

  _normalizeDriveModel(value) {
    if ([0, 1, 2, 3].includes(Number(value)) && String(value).trim() !== '') {
      const numericModels = {
        0: { kind: 'dd', actionModelType: 0 },
        1: { kind: 'qd', actionModelType: 1 },
        2: { kind: 'trailer', actionModelType: 2 },
        3: { kind: 'forklift', actionModelType: 3 }
      };
      return numericModels[Number(value)];
    }
    const normalized = String(value || '').trim().toLowerCase();
    if (['qd', 'quad', 'omni', 'holonomic'].includes(normalized)) {
      return { kind: 'qd', actionModelType: 1 };
    }
    if (['trailer', 'on_axle_trailer', 'on-axle-trailer'].includes(normalized)) {
      return { kind: 'trailer', actionModelType: 2 };
    }
    if (['forklift', 'slim_forklift'].includes(normalized)) {
      return { kind: 'forklift', actionModelType: 3 };
    }
    if (['dd', 'rdd', 'diff', 'differential'].includes(normalized)) {
      return { kind: normalized === 'rdd' ? 'rdd' : 'dd', actionModelType: 0 };
    }
    return null;
  },

  async _discoverDriveModel(slot, profile) {
    const rid = String(slot?.robotId || '').replace(/^\//, '');
    const ns = `/${rid}`;
    const result = {
      attempted: true,
      verified: false,
      kind: null,
      actionModelType: null,
      parameter: null,
      reason: 'ROS parameter에서 차상 model_type을 확인하지 못했습니다.'
    };
    profile.chassis.driveModel = result;
    const candidates = [
      `${ns}/basic_settings/model_type`, `${ns}/SUBCON_/model_type`, `${ns}/model_type`,
      `${ns}/drive_type`, '/SUBCON_/model_type', '/model_type', '/drive_type'
    ];
    const getParamType = profile?.transport?.rosMajor === 2
      ? 'rosapi/srv/GetParam'
      : 'rosapi/GetParam';
    const reads = await Promise.all(candidates.map(async name => {
      try {
        const response = await this._rosapi(
          slot.ros, '/rosapi/get_param', getParamType, { name, default: '' }, 900
        );
        return { name, value: this._parseRosParamValue(response?.value) };
      } catch (error) {
        return { name, value: null };
      }
    }));
    for (const read of reads) {
      const model = this._normalizeDriveModel(read.value);
      if (!model) continue;
      Object.assign(result, {
        verified: true,
        ...model,
        parameter: read.name,
        reason: ''
      });
      break;
    }
    return result;
  },

  async _lookupType(ros, apiName, apiType, args, endpoint, timeout) {
    try {
      const response = await this._rosapi(ros, apiName, apiType, args, timeout);
      return [endpoint, String(response?.type || '')];
    } catch (error) {
      return [endpoint, ''];
    }
  },

  _matchesType(actual, allowed) {
    return Boolean(actual) && allowed.includes(String(actual));
  },

  _verifiedEndpoint(name, actualType, allowedTypes, missingReason) {
    if (!name) return { verified: false, name: null, type: null, reason: missingReason };
    if (!actualType) {
      return { verified: false, name, type: null, reason: `${name} type을 확인하지 못했습니다.` };
    }
    if (!this._matchesType(actualType, allowedTypes)) {
      return { verified: false, name, type: actualType, reason: `${name} type 불일치: ${actualType}` };
    }
    return { verified: true, name, type: actualType, reason: '' };
  },

  _buildTaskAdapter(protocol, ns, services, topics, serviceTypes, topicTypes) {
    const isLegacy = protocol === 'ros1_legacy';
    const isRos2 = protocol === 'ros2_spx';
    const prefix = isLegacy ? `${ns}/TARU` : `${ns}/spx/task`;
    const types = isLegacy ? {
      goal: ['sp_task/TaskGoal'], pause: ['sp_task/Int32_srv'],
      resume: ['sp_task/Int32_srv'], cancel: ['sp_task/String_srv'],
      feedback: ['sp_task/Feedback'], result: ['sp_task/Result']
    } : (isRos2 ? {
      goal: ['spx_task_msgs/srv/TaskGoal'], pause: ['spx_task_msgs/srv/TaskPause'],
      resume: ['spx_task_msgs/srv/TaskResume'], cancel: ['spx_task_msgs/srv/TaskCancel'],
      feedback: ['spx_task_msgs/msg/TaskFeedback'], result: ['spx_task_msgs/msg/TaskResult']
    } : {
      goal: ['spx_task_msgs/TaskGoal'], pause: ['spx_task_msgs/TaskPause'],
      resume: ['spx_task_msgs/TaskResume'], cancel: ['spx_task_msgs/TaskCancel'],
      feedback: ['spx_task_msgs/TaskFeedback'], result: ['spx_task_msgs/TaskResult']
    });
    const service = key => {
      const name = `${prefix}/${key}`;
      return this._verifiedEndpoint(
        services.includes(name) ? name : null,
        serviceTypes[name],
        types[key],
        `${name} 미발견`
      );
    };
    const goal = service('goal');
    if (!goal.verified) return { verified: false, protocol, reason: goal.reason };
    const pause = service('pause');
    const resume = service('resume');
    const cancel = service('cancel');
    const rid = ns.slice(1);
    const localFeedback = `${prefix}/feedback`;
    const localResult = `${prefix}/result`;
    const bridgeFeedback = `/dt/ros/task/${rid}/feedback`;
    const bridgeResult = `/dt/ros/task/${rid}/result`;
    const feedbackName = topics.includes(localFeedback)
      ? localFeedback
      : (isLegacy && topics.includes(bridgeFeedback) ? bridgeFeedback : null);
    const resultName = topics.includes(localResult)
      ? localResult
      : (isLegacy && topics.includes(bridgeResult) ? bridgeResult : null);
    const feedback = this._verifiedEndpoint(
      feedbackName, topicTypes[feedbackName], types.feedback, `${localFeedback} 미발견`
    );
    const result = this._verifiedEndpoint(
      resultName, topicTypes[resultName], types.result, `${localResult} 미발견`
    );
    const stateName = isLegacy && topics.includes(`${ns}/taru_state`) ? `${ns}/taru_state` : null;
    const state = this._verifiedEndpoint(
      stateName, topicTypes[stateName], ['std_msgs/Int32'], `${ns}/taru_state 미발견`
    );
    return {
      verified: true,
      protocol,
      variant: isLegacy ? 'sp_task' : 'spx',
      reason: '',
      goalName: goal.name,
      goalType: goal.type,
      pauseName: pause.verified ? pause.name : null,
      pauseType: pause.verified ? pause.type : null,
      pauseArgs: isLegacy ? { data: 0 } : {},
      resumeName: resume.verified ? resume.name : null,
      resumeType: resume.verified ? resume.type : null,
      resumeArgs: isLegacy ? { data: 0 } : {},
      cancelName: cancel.verified ? cancel.name : null,
      cancelType: cancel.verified ? cancel.type : null,
      cancelArgs: isLegacy ? { data: '' } : {},
      feedbackName: feedback.verified ? feedback.name : null,
      feedbackType: feedback.verified ? feedback.type : null,
      resultName: result.verified ? result.name : null,
      resultType: result.verified ? result.type : null,
      stateName: state.verified ? state.name : null,
      stateType: state.verified ? state.type : null,
      operations: { goal, pause, resume, cancel, feedback, result, state }
    };
  },

  _buildProfile(slot, services = [], topics = [], serviceTypes = {}, topicTypes = {}) {
    const profile = this._defaultProfile(slot, '지원 계약에 맞는 endpoint/type이 없습니다.');
    const rid = String(slot.robotId || '').replace(/^\//, '');
    const ns = `/${rid}`;
    const hasService = name => services.includes(name);
    const hasTopic = name => topics.includes(name);
    profile.discovered = true;
    profile.transport.available = true;
    profile.evidence = { services, topics, serviceTypes, topicTypes };
    profile.services = services;
    profile.topics = topics;
    profile.serviceTypes = serviceTypes;
    profile.topicTypes = topicTypes;

    const typeValues = [...Object.values(serviceTypes), ...Object.values(topicTypes)];
    const hasRos2Type = typeValues.some(type => /\/(srv|msg)\//.test(type));
    profile.transport.rosMajor = hasRos2Type ? 2 : 1;
    profile.transport.protocol = hasRos2Type ? 'ros2_spx' : 'ros1';
    profile.transport.reason = '';

    const taskAdapters = {};
    ['ros2_spx', 'ros1_spx', 'ros1_legacy'].forEach(protocol => {
      const adapter = this._buildTaskAdapter(protocol, ns, services, topics, serviceTypes, topicTypes);
      if (adapter.verified) taskAdapters[protocol] = adapter;
    });
    const task = taskAdapters.ros2_spx || taskAdapters.ros1_spx || taskAdapters.ros1_legacy
      || { ...profile.task, adapters: taskAdapters };
    profile.task = { ...task, adapters: taskAdapters };

    const spxModeName = `${ns}/spx/set_mode`;
    const operationName = `${ns}/spx/operation_mode`;
    const ros2Mode = this._verifiedEndpoint(
      hasService(spxModeName) ? spxModeName : null,
      serviceTypes[spxModeName],
      ['spx_robot_msgs/srv/SetMode'],
      `${spxModeName} 미발견`
    );
    const ros1Mode = this._verifiedEndpoint(
      hasService(spxModeName) ? spxModeName : null,
      serviceTypes[spxModeName],
      ['spx_msgs/SetMode'],
      `${spxModeName} 미발견`
    );
    const spxStatus = this._verifiedEndpoint(
      hasTopic(operationName) ? operationName : null,
      topicTypes[operationName],
      hasRos2Type ? ['std_msgs/msg/String'] : ['std_msgs/String'],
      `${operationName} 미발견`
    );
    const legacyCommandName = `${ns}/sp_routine`;
    const legacyStatusName = `${ns}/spcore/MODE`;
    const legacyCommand = this._verifiedEndpoint(
      hasTopic(legacyCommandName) ? legacyCommandName : null,
      topicTypes[legacyCommandName], ['std_msgs/String'], `${legacyCommandName} 미발견`
    );
    const legacyStatus = this._verifiedEndpoint(
      hasTopic(legacyStatusName) ? legacyStatusName : null,
      topicTypes[legacyStatusName], ['std_msgs/String'], `${legacyStatusName} 미발견`
    );
    if ((ros2Mode.verified || ros1Mode.verified) && spxStatus.verified) {
      const command = ros2Mode.verified ? ros2Mode : ros1Mode;
      profile.mapping = {
        verified: true,
        protocol: ros2Mode.verified ? 'ros2_spx' : 'ros1_spx',
        reason: '',
        commandInterface: 'service',
        commandName: command.name,
        commandType: command.type,
        statusName: spxStatus.name,
        statusType: spxStatus.type
      };
    } else if (legacyCommand.verified && legacyStatus.verified) {
      profile.mapping = {
        verified: true,
        protocol: 'ros1_legacy',
        reason: '',
        commandInterface: 'topic',
        commandName: legacyCommand.name,
        commandType: legacyCommand.type,
        statusName: legacyStatus.name,
        statusType: legacyStatus.type
      };
    }

    const mapTopicName = hasTopic(`${ns}/map`) ? `${ns}/map` : (hasTopic('/map') ? '/map' : null);
    const mapTopic = this._verifiedEndpoint(
      mapTopicName,
      topicTypes[mapTopicName],
      ['nav_msgs/OccupancyGrid', 'nav_msgs/msg/OccupancyGrid'],
      'map topic 미발견'
    );
    // A topic's existence does not prove publisher direction. On older
    // slam_toolbox builds /{RID}/slam_toolbox/map is an input subscriber while
    // the live Mapping grid is still published on /{RID}/map.
    const toolboxMapName = `${ns}/slam_toolbox/map`;
    const mappingMapTopicName = mapTopicName
      || (hasTopic(toolboxMapName) ? toolboxMapName : null);
    const mappingMapTopic = this._verifiedEndpoint(
      mappingMapTopicName,
      topicTypes[mappingMapTopicName],
      ['nav_msgs/OccupancyGrid', 'nav_msgs/msg/OccupancyGrid'],
      'Mapping map topic 미발견'
    );
    const saveName = hasService(`${ns}/save_map`) ? `${ns}/save_map` : null;
    const save = this._verifiedEndpoint(
      saveName,
      serviceTypes[saveName],
      ['syscon_msgs/String_srv', 'syscon_msgs/SaveMap', 'spx_msgs/SaveMap', 'spx_mapping_msgs/srv/SaveMap'],
      `${ns}/save_map 미발견`
    );
    const reloadName = hasService(`${ns}/change_map`) ? `${ns}/change_map` : null;
    const reload = this._verifiedEndpoint(
      reloadName,
      serviceTypes[reloadName],
      ['map_server/LoadMap', 'syscon_msgs/ChangeMap', 'spx_mapping_msgs/srv/LoadMap'],
      `${ns}/change_map 미발견`
    );
    const amclName = hasService(`${ns}/amcl/change_map`) ? `${ns}/amcl/change_map` : null;
    const amcl = this._verifiedEndpoint(
      amclName,
      serviceTypes[amclName],
      ['syscon_msgs/ChangeMap'],
      `${ns}/amcl/change_map 미발견`
    );
    const poseGraphName = hasService(`${ns}/slam_toolbox/serialize_map`)
      ? `${ns}/slam_toolbox/serialize_map`
      : (hasService('/slam_toolbox/serialize_map') ? '/slam_toolbox/serialize_map' : null);
    const poseGraph = this._verifiedEndpoint(
      poseGraphName,
      serviceTypes[poseGraphName],
      ['slam_toolbox_msgs/SerializePoseGraph', 'slam_toolbox_msgs/srv/SerializePoseGraph'],
      'pose graph save service 미발견'
    );
    profile.map = {
      ...profile.map,
      verified: mapTopic.verified || save.verified || reload.verified,
      protocol: save.type === 'spx_mapping_msgs/srv/SaveMap'
        ? 'ros2_spx'
        : (save.type === 'spx_msgs/SaveMap' ? 'ros1_spx' : (mapTopic.verified ? 'ros1_legacy' : null)),
      reason: mapTopic.reason || save.reason,
      topic: mapTopic.verified ? mapTopic.name : null,
      topicType: mapTopic.verified ? mapTopic.type : null,
      mappingTopic: mappingMapTopic.verified ? mappingMapTopic.name : null,
      mappingTopicType: mappingMapTopic.verified ? mappingMapTopic.type : null,
      mappingTopicCandidates: Array.from(new Set([
        ...(mapTopic.verified ? [mapTopic.name] : []),
        ...(hasTopic(toolboxMapName)
          && this._matchesType(topicTypes[toolboxMapName], [
            'nav_msgs/OccupancyGrid', 'nav_msgs/msg/OccupancyGrid'
          ])
          ? [toolboxMapName]
          : [])
      ])),
      saveService: save.verified ? save.name : null,
      saveType: save.verified ? save.type : null,
      saveUsesName: save.verified && save.type === 'syscon_msgs/String_srv',
      reloadService: reload.verified ? reload.name : null,
      reloadType: reload.verified ? reload.type : null,
      amclChangeService: amcl.verified ? amcl.name : null,
      amclChangeType: amcl.verified ? amcl.type : null,
      poseGraphSaveService: poseGraph.verified ? poseGraph.name : null,
      poseGraphSaveType: poseGraph.verified ? poseGraph.type : null,
      managesRosNodes: reload.verified
    };

    const liftServiceName = hasService(`${ns}/Lift/cmd`) ? `${ns}/Lift/cmd` : null;
    const liftService = this._verifiedEndpoint(
      liftServiceName, serviceTypes[liftServiceName],
      ['syscon_msgs/lift_cmd', 'syscon_msgs/srv/LiftCmd'], `${ns}/Lift/cmd 미발견`
    );
    const liftTopicName = hasTopic(`${ns}/Lift/manual_cmd`) ? `${ns}/Lift/manual_cmd` : null;
    const liftTopic = this._verifiedEndpoint(
      liftTopicName, topicTypes[liftTopicName],
      ['std_msgs/Int8', 'std_msgs/msg/Int8'], `${ns}/Lift/manual_cmd 미발견`
    );
    const liftCancelName = hasService(`${ns}/Lift/cancel`) ? `${ns}/Lift/cancel` : null;
    const liftCancel = this._verifiedEndpoint(
      liftCancelName, serviceTypes[liftCancelName],
      ['syscon_msgs/string_srv', 'syscon_msgs/srv/StringSrv'], `${ns}/Lift/cancel 미발견`
    );
    const liftFeedbackName = hasTopic(`${ns}/Lift/feedback`) ? `${ns}/Lift/feedback` : null;
    const liftFeedback = this._verifiedEndpoint(
      liftFeedbackName, topicTypes[liftFeedbackName],
      ['syscon_msgs/LiftFeedback', 'syscon_msgs/msg/LiftFeedback'], `${ns}/Lift/feedback 미발견`
    );
    if (liftService.verified || liftTopic.verified) {
      profile.lift = {
        verified: true,
        protocol: hasRos2Type ? 'ros2_spx' : (liftService.verified ? 'ros1_service' : 'ros1_topic'),
        reason: '',
        interface: liftService.verified ? 'service' : 'topic',
        service: liftService.verified ? liftService.name : null,
        serviceType: liftService.verified ? liftService.type : null,
        topic: liftTopic.verified ? liftTopic.name : null,
        topicType: liftTopic.verified ? liftTopic.type : null,
        cancelService: liftCancel.verified ? liftCancel.name : null,
        cancelType: liftCancel.verified ? liftCancel.type : null,
        cancelArgs: liftCancel.verified ? { data: '' } : null,
        feedbackTopic: liftFeedback.verified ? liftFeedback.name : null,
        feedbackType: liftFeedback.verified ? liftFeedback.type : null,
        commands: liftService.verified ? { stop: 0, up: 1, down: 2 } : { stop: 0, up: 1, down: -1 }
      };
    }

    const turntableName = hasService(`${ns}/Turntable/cmd`) ? `${ns}/Turntable/cmd` : null;
    const turntable = this._verifiedEndpoint(
      turntableName, serviceTypes[turntableName],
      ['syscon_msgs/turntable_cmd', 'syscon_msgs/srv/TurntableCmd'], `${ns}/Turntable/cmd 미발견`
    );
    const turntableCancelName = hasService(`${ns}/Turntable/cancel`) ? `${ns}/Turntable/cancel` : null;
    const turntableCancel = this._verifiedEndpoint(
      turntableCancelName, serviceTypes[turntableCancelName],
      ['syscon_msgs/string_srv', 'syscon_msgs/srv/StringSrv'], `${ns}/Turntable/cancel 미발견`
    );
    const syncName = hasService(`${ns}/Turntable/sync_mode`) ? `${ns}/Turntable/sync_mode` : null;
    const sync = this._verifiedEndpoint(
      syncName, serviceTypes[syncName],
      ['std_srvs/SetBool', 'std_srvs/srv/SetBool'], `${ns}/Turntable/sync_mode 미발견`
    );
    const turntableFeedbackName = hasTopic(`${ns}/Turntable/feedback`) ? `${ns}/Turntable/feedback` : null;
    const turntableFeedback = this._verifiedEndpoint(
      turntableFeedbackName, topicTypes[turntableFeedbackName],
      ['syscon_msgs/LiftFeedback', 'syscon_msgs/msg/LiftFeedback'], `${ns}/Turntable/feedback 미발견`
    );
    if (turntable.verified) {
      profile.actions.turntable = {
        verified: true,
        protocol: hasRos2Type ? 'ros2_spx' : 'ros1_service',
        reason: '',
        enabled: true,
        argCount: 3,
        asyncModeArg: true,
        service: turntable.name,
        serviceType: turntable.type,
        cancelService: turntableCancel.verified ? turntableCancel.name : null,
        cancelType: turntableCancel.verified ? turntableCancel.type : null,
        feedbackTopic: turntableFeedback.verified ? turntableFeedback.name : null,
        feedbackType: turntableFeedback.verified ? turntableFeedback.type : null,
        syncService: sync.verified ? sync.name : null,
        syncType: sync.verified ? sync.type : null
      };
    }

    const driveName = hasTopic(`${ns}/cmd_vel`) ? `${ns}/cmd_vel` : null;
    const drive = this._verifiedEndpoint(
      driveName, topicTypes[driveName],
      ['geometry_msgs/Twist', 'geometry_msgs/msg/Twist'], `${ns}/cmd_vel 미발견`
    );
    const conveyorName = hasService(`${ns}/Conv/cmd`) ? `${ns}/Conv/cmd` : null;
    const conveyor = this._verifiedEndpoint(
      conveyorName, serviceTypes[conveyorName],
      ['syscon_msgs/conv_cmd', 'syscon_msgs/srv/ConvCmd'], `${ns}/Conv/cmd 미발견`
    );
    const motorResetName = hasService(`${ns}/motor_reset`) ? `${ns}/motor_reset` : null;
    const motorReset = this._verifiedEndpoint(
      motorResetName, serviceTypes[motorResetName],
      ['std_srvs/Trigger', 'std_srvs/srv/Trigger'], `${ns}/motor_reset 미발견`
    );
    const liftMotorResetName = hasService(`${ns}/Lift/motor_reset`) ? `${ns}/Lift/motor_reset` : null;
    const liftMotorReset = this._verifiedEndpoint(
      liftMotorResetName, serviceTypes[liftMotorResetName],
      ['std_srvs/Trigger', 'std_srvs/srv/Trigger'], `${ns}/Lift/motor_reset 미발견`
    );
    const chargeCandidates = [
      `${ns}/io/set/auto_charge_relay`, `${ns}/io/set/auto_charge`,
      `${ns}/SUBCON_/charge_relay_cmd`, `${ns}/device_manager/charge_relay_cmd`,
      `${ns}/io/set/charge_relay`, `${ns}/io/charge_relay`, `${ns}/set_charging_switch`
    ];
    let charge = { verified: false, reason: '검증된 charge relay service/type이 없습니다.' };
    chargeCandidates.some(name => {
      if (!hasService(name)) return false;
      const endpoint = this._verifiedEndpoint(
        name, serviceTypes[name],
        ['std_srvs/SetBool', 'std_srvs/srv/SetBool'], `${name} 미발견`
      );
      if (!endpoint.verified) return false;
      charge = { ...endpoint, service: endpoint.name, serviceType: endpoint.type };
      return true;
    });
    profile.chassis = {
      verified: drive.verified || conveyor.verified || charge.verified,
      protocol: hasRos2Type ? 'ros2_spx' : 'ros1',
      reason: drive.reason,
      drive: { ...drive, topic: drive.name, topicType: drive.type },
      conveyor: { ...conveyor, service: conveyor.name, serviceType: conveyor.type },
      charge,
      motorReset: { ...motorReset, service: motorReset.name, serviceType: motorReset.type },
      liftMotorReset: {
        ...liftMotorReset,
        service: liftMotorReset.name,
        serviceType: liftMotorReset.type
      }
    };

    const monitoringSpecs = {
      bms: [`${ns}/bms`, ['std_msgs/Float32MultiArray', 'std_msgs/msg/Float32MultiArray']],
      robotState: [`${ns}/robot_state`, ['syscon_msgs/RobotState', 'syscon_msgs/msg/RobotState']],
      motorStatus: [`${ns}/motor_status`, ['syscon_msgs/MotorState', 'syscon_msgs/msg/MotorState']],
      odom: [`${ns}/odom`, ['nav_msgs/Odometry', 'nav_msgs/msg/Odometry']],
      manualSelect: [`${ns}/io/select`, ['std_msgs/Bool', 'std_msgs/msg/Bool']],
      emergency: [`${ns}/emergency_sensor`, ['std_msgs/Int32MultiArray', 'std_msgs/msg/Int32MultiArray']],
      sto: [`${ns}/sto_stop`, ['std_msgs/Bool', 'std_msgs/msg/Bool']],
      lidarField: [`${ns}/io/lidar_field`, ['std_msgs/UInt8', 'std_msgs/msg/UInt8']],
      brakeReleased: [`${ns}/io/break_released`, ['std_msgs/Bool', 'std_msgs/msg/Bool']]
    };
    const monitoringTopics = {};
    Object.entries(monitoringSpecs).forEach(([key, [name, allowed]]) => {
      const endpoint = this._verifiedEndpoint(
        hasTopic(name) ? name : null, topicTypes[name], allowed, `${name} 미발견`
      );
      if (endpoint.verified) monitoringTopics[key] = { name: endpoint.name, type: endpoint.type };
    });
    profile.monitoring = {
      verified: Object.keys(monitoringTopics).length > 0,
      protocol: hasRos2Type ? 'ros2_spx' : 'ros1',
      reason: Object.keys(monitoringTopics).length ? '' : '검증된 monitoring topic이 없습니다.',
      topics: monitoringTopics
    };

    profile.capabilities = {
      task: profile.task,
      mode: profile.mapping,
      map: profile.map,
      lift: profile.lift,
      turntable: profile.actions.turntable,
      chassis: profile.chassis,
      monitoring: profile.monitoring
    };
    const protocols = [profile.task.protocol, profile.mapping.protocol, profile.map.protocol]
      .filter(Boolean);
    profile.id = protocols.includes('ros2_spx')
      ? 'ros2_spx'
      : (protocols.includes('ros1_spx') ? 'ros1_spx' : (protocols.includes('ros1_legacy') ? 'ros1_legacy' : 'verified_partial'));
    profile.controlReady = [profile.task, profile.mapping, profile.map, profile.lift,
      profile.actions.turntable, profile.chassis].some(capability => capability?.verified);
    profile.reason = profile.controlReady ? '' : '지원 계약과 type이 일치하는 제어 기능이 없습니다.';
    profile.project = slot.projectHint || (this.isStlUlsanModel(slot.robotModel) ? 'stl_ulsan' : null);
    const lineage = this.projectGeneration(profile.project);
    profile.lineage = lineage ? { id: lineage.id, label: lineage.label } : null;
    return profile;
  },

  capability(profile, name) {
    return profile?.capabilities?.[name] || this._unavailableCapability('기능 정보 없음');
  },

  requireCapability(profile, name, actionLabel = name) {
    const capability = this.capability(profile, name);
    if (!profile?.discovered) {
      throw new Error(`${actionLabel} 차단: ${profile?.reason || 'ROS graph 검증 전'}`);
    }
    if (!capability?.verified) {
      throw new Error(`${actionLabel} 차단: ${capability?.reason || '검증된 endpoint/type 없음'}`);
    }
    return capability;
  },

  actionSupport(profile, actionType) {
    const type = Number(actionType);
    if (!profile?.discovered || !profile?.task?.verified) {
      return {
        verified: false,
        type,
        reason: profile?.task?.reason || profile?.reason || 'Task graph 미검증'
      };
    }
    const catalog = profile.task.actionCatalog;
    if (!catalog?.attempted) {
      return { verified: false, type, pending: true, reason: '등록 Action 목록 확인 전' };
    }
    if (!catalog.verified) {
      return { verified: false, type, reason: catalog.reason || '등록 Action 목록 자동감지 실패' };
    }
    const action = catalog.actions.find(item => Number(item.type) === type) || null;
    return action
      ? { verified: true, type, action, reason: '' }
      : { verified: false, type, reason: `Action 0x${type.toString(16).padStart(2, '0')} 미등록` };
  },

  requireAction(profile, actionType, label = 'Task Action') {
    const support = this.actionSupport(profile, actionType);
    if (!support.verified) throw new Error(`${label} 차단: ${support.reason}`);
    return support;
  },

  mapSaveRequest(profile) {
    const map = this.requireCapability(profile, 'map', 'Map 저장');
    if (!map.saveService || !map.saveType) throw new Error('Map 저장 endpoint/type이 검증되지 않았습니다.');
    if (map.saveType === 'syscon_msgs/String_srv') return { data: map.baseName || 'map' };
    return { save_in_db: true };
  },

  mapPoseGraphSaveRequest(profile) {
    const map = profile?.map || {};
    if (!map.poseGraphSaveService || !map.poseGraphSaveType) {
      throw new Error('Pose graph 저장 endpoint/type이 검증되지 않았습니다.');
    }
    const directory = String(map.directory || '/home/syscon/ROS_DB/map').replace(/\/$/, '');
    return { filename: `${directory}/${map.baseName || 'map'}` };
  },

  mapReloadRequest(profile, yamlPath) {
    const map = profile?.map || {};
    if (!map.reloadService || !map.reloadType) {
      throw new Error('Map 불러오기 endpoint/type이 검증되지 않았습니다.');
    }
    if (map.reloadType === 'map_server/LoadMap') return { map_url: yamlPath };
    if (map.reloadType === 'spx_mapping_msgs/srv/LoadMap') return { map_name: yamlPath };
    return { path: yamlPath };
  },

  _rosapi(ros, name, serviceType, args, timeoutMs = this.DISCOVERY_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback(value);
      };
      const timer = setTimeout(
        () => finish(reject, new Error(`${name} timeout`)),
        timeoutMs
      );
      try {
        const service = new ROSLIB.Service({ ros, name, serviceType });
        service.callService(
          new ROSLIB.ServiceRequest(args || {}),
          result => finish(resolve, result || {}),
          error => finish(reject, new Error(String(error || `${name} failed`)))
        );
      } catch (error) {
        finish(reject, error);
      }
    });
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = RobotCompatibility;
}
