// Runtime ROS interface discovery for mixed Scorpion robot generations.
// Keep model-specific transport details here instead of scattering RID/model checks.
const RobotCompatibility = {
  DISCOVERY_TIMEOUT_MS: 2500,
  TUNNEL_DISCOVERY_TIMEOUT_MS: 6000,
  STL_ULSAN_MODELS: new Set(['stl1000w', 'stl1500w']),

  normalizeRobotModel(model) {
    return String(model || '').trim().toLowerCase();
  },

  isStlUlsanModel(model) {
    return this.STL_ULSAN_MODELS.has(this.normalizeRobotModel(model));
  },

  _discoveryTimeout(slot) {
    return slot?.tunnelMode
      ? this.TUNNEL_DISCOVERY_TIMEOUT_MS
      : this.DISCOVERY_TIMEOUT_MS;
  },

  _defaultProfile(slot = {}) {
    const rid = String(slot.robotId || '').replace(/^\//, '');
    const ns = rid ? `/${rid}` : '';
    const isStlUlsan = this.isStlUlsanModel(slot.robotModel);
    return {
      id: isStlUlsan ? 'stl_ulsan' : 'scorpion_legacy',
      project: isStlUlsan ? 'stl_ulsan' : null,
      model: slot.robotModel || '',
      discovered: false,
      topics: [],
      services: [],
      serviceTypes: {},
      map: {
        topic: `${ns}/map`,
        staticService: `${ns}/static_map`,
        baseName: 'map',
        directory: '/home/syscon/ROS_DB/map',
        saveService: `${ns}/save_map`,
        saveType: 'syscon_msgs/String_srv',
        saveUsesName: true,
        poseGraphSaveService: null,
        poseGraphSaveType: 'slam_toolbox_msgs/SerializePoseGraph',
        reloadService: null,
        reloadType: null,
        amclChangeService: `${ns}/amcl/change_map`,
        amclChangeType: 'syscon_msgs/ChangeMap',
        compression: 'png',
        managesRosNodes: false
      },
      mapping: {
        commandTopic: `${ns}/sp_routine`,
        statusTopics: [`${ns}/spx/operation_mode`, `${ns}/spcore/MODE`]
      },
      lift: {
        interface: isStlUlsan ? 'service' : 'topic',
        topic: isStlUlsan ? null : `${ns}/Lift/manual_cmd`,
        topicType: isStlUlsan ? null : 'std_msgs/Int8',
        service: isStlUlsan ? `${ns}/Lift/cmd` : null,
        serviceType: isStlUlsan ? 'syscon_msgs/lift_cmd' : null,
        cancelService: isStlUlsan ? `${ns}/Lift/cancel` : null,
        cancelType: isStlUlsan ? 'syscon_msgs/string_srv' : null,
        cancelArgs: isStlUlsan ? { data: '' } : null,
        commands: isStlUlsan
          ? { stop: 0, up: 1, down: 2 }
          : { stop: 0, up: 1, down: -1 }
      },
      actions: {
        turntable: {
          enabled: isStlUlsan,
          argCount: isStlUlsan ? 3 : 2,
          asyncModeArg: isStlUlsan,
          service: isStlUlsan ? `${ns}/Turntable/cmd` : null,
          serviceType: isStlUlsan ? 'syscon_msgs/turntable_cmd' : null,
          cancelService: isStlUlsan ? `${ns}/Turntable/cancel` : null,
          cancelType: isStlUlsan ? 'syscon_msgs/string_srv' : null
        }
      },
      task: {
        variant: 'sp_task',
        goalName: `${ns}/TARU/goal`,
        goalType: 'sp_task/TaskGoal',
        pauseName: `${ns}/TARU/pause`,
        pauseType: 'sp_task/Int32_srv',
        pauseArgs: { data: 0 },
        resumeName: `${ns}/TARU/resume`,
        resumeType: 'sp_task/Int32_srv',
        resumeArgs: { data: 0 },
        cancelName: `${ns}/TARU/cancel`,
        cancelType: 'sp_task/String_srv',
        cancelArgs: { data: '' },
        feedbackName: `${ns}/TARU/feedback`,
        feedbackType: 'sp_task/Feedback',
        resultName: `${ns}/TARU/result`,
        resultType: 'sp_task/Result',
        stateName: `${ns}/taru_state`,
        stateType: 'std_msgs/Int32'
      }
    };
  },

  get(slot) {
    return slot?.compatibilityProfile || this._defaultProfile(slot);
  },

  clear(slot) {
    if (!slot) return;
    delete slot.compatibilityProfile;
    delete slot.compatibilityPromise;
  },

  async discover(slot, options = {}) {
    if (!slot?.ros || !slot.robotId) return this._defaultProfile(slot);
    if (!options.force && slot.compatibilityProfile?.discovered) {
      return slot.compatibilityProfile;
    }
    if (!options.force && slot.compatibilityPromise) return slot.compatibilityPromise;

    const promise = this._discover(slot)
      .catch(error => {
        console.warn(`[Compatibility] ${slot.robotId} discovery failed:`, error?.message || error);
        const fallback = this._defaultProfile(slot);
        slot.compatibilityProfile = fallback;
        return fallback;
      })
      .finally(() => {
        delete slot.compatibilityPromise;
      });
    slot.compatibilityPromise = promise;
    return promise;
  },

  async _discover(slot) {
    const discoveryTimeout = this._discoveryTimeout(slot);
    const [servicesResult, topicsResult] = await Promise.all([
      this._rosapi(slot.ros, '/rosapi/services', 'rosapi/Services', {}, discoveryTimeout),
      this._rosapi(slot.ros, '/rosapi/topics', 'rosapi/Topics', {}, discoveryTimeout)
    ]);
    const services = Array.from(servicesResult?.services || []);
    const topics = Array.from(topicsResult?.topics || []);
    const rid = String(slot.robotId).replace(/^\//, '');
    const ns = `/${rid}`;
    const typeCandidates = [
      `${ns}/save_map`, `${ns}/change_map`, `${ns}/amcl/change_map`,
      `${ns}/slam_toolbox/serialize_map`, '/slam_toolbox/serialize_map',
      `${ns}/Lift/cmd`, `${ns}/Lift/cancel`,
      `${ns}/Turntable/cmd`, `${ns}/Turntable/cancel`,
      `${ns}/TARU/goal`, `${ns}/spx/task/goal`
    ].filter(name => services.includes(name));
    const typeEntries = await Promise.all(typeCandidates.map(async name => {
      try {
        const response = await this._rosapi(
          slot.ros,
          '/rosapi/service_type',
          'rosapi/ServiceType',
          { service: name },
          discoveryTimeout
        );
        return [name, response?.type || ''];
      } catch (error) {
        return [name, ''];
      }
    }));
    const serviceTypes = Object.fromEntries(typeEntries);
    const profile = this._buildProfile(slot, services, topics, serviceTypes);
    slot.compatibilityProfile = profile;
    console.log(
      `[Compatibility] ${slot.robotId}: ${profile.id}`,
      { map: profile.map, lift: profile.lift.interface, task: profile.task.variant }
    );
    return profile;
  },

  _buildProfile(slot, services, topics, serviceTypes = {}) {
    const profile = this._defaultProfile(slot);
    const rid = String(slot.robotId).replace(/^\//, '');
    const ns = `/${rid}`;
    const hasService = name => services.includes(name);
    const hasTopic = name => topics.includes(name);
    const saveName = `${ns}/save_map`;
    const saveType = serviceTypes[saveName] || profile.map.saveType;
    const serviceLift = `${ns}/Lift/cmd`;
    const cancelLift = `${ns}/Lift/cancel`;
    const topicLift = `${ns}/Lift/manual_cmd`;
    const modernTask = `${ns}/spx/task/goal`;
    const legacyTask = `${ns}/TARU/goal`;
    const turntableService = `${ns}/Turntable/cmd`;
    const turntableCancel = `${ns}/Turntable/cancel`;
    const isStlUlsan = this.isStlUlsanModel(slot.robotModel);
    const hasServiceMapApi = hasService(`${ns}/change_map`)
      && /(^|\/)SaveMap$/.test(saveType);

    profile.discovered = true;
    profile.topics = topics;
    profile.services = services;
    profile.serviceTypes = serviceTypes;
    profile.id = isStlUlsan
      ? 'stl_ulsan'
      : (hasService(serviceLift) ? 'scorpion_service_lift' : 'scorpion_legacy');
    profile.project = isStlUlsan ? 'stl_ulsan' : null;
    if (isStlUlsan) {
      profile.actions.turntable = {
        enabled: true,
        argCount: 3,
        asyncModeArg: true,
        service: hasService(turntableService) ? turntableService : `${ns}/Turntable/cmd`,
        serviceType: serviceTypes[turntableService] || 'syscon_msgs/turntable_cmd',
        cancelService: hasService(turntableCancel) ? turntableCancel : `${ns}/Turntable/cancel`,
        cancelType: serviceTypes[turntableCancel] || 'syscon_msgs/string_srv'
      };
    }

    profile.map.topic = hasTopic(`${ns}/map`)
      ? `${ns}/map`
      : (hasTopic('/map') ? '/map' : `${ns}/map`);
    profile.map.staticService = hasService(`${ns}/static_map`)
      ? `${ns}/static_map`
      : (hasService('/static_map') ? '/static_map' : `${ns}/static_map`);
    profile.map.saveService = hasService(saveName) ? saveName : profile.map.saveService;
    profile.map.saveType = saveType;
    profile.map.saveUsesName = !/(^|\/)SaveMap$/.test(saveType);
    const poseGraphSaveName = hasService(`${ns}/slam_toolbox/serialize_map`)
      ? `${ns}/slam_toolbox/serialize_map`
      : (hasService('/slam_toolbox/serialize_map') ? '/slam_toolbox/serialize_map' : null);
    profile.map.poseGraphSaveService = poseGraphSaveName;
    if (poseGraphSaveName) {
      profile.map.poseGraphSaveType = serviceTypes[poseGraphSaveName]
        || profile.map.poseGraphSaveType;
    }
    if (hasService(`${ns}/change_map`)) {
      profile.map.reloadService = `${ns}/change_map`;
      profile.map.reloadType = serviceTypes[`${ns}/change_map`] || 'map_server/LoadMap';
    }
    profile.map.managesRosNodes = Boolean(profile.map.reloadService && hasServiceMapApi);

    if (hasService(serviceLift)) {
      profile.lift = {
        interface: 'service',
        service: serviceLift,
        serviceType: serviceTypes[serviceLift] || 'syscon_msgs/lift_cmd',
        cancelService: hasService(cancelLift) ? cancelLift : null,
        cancelType: serviceTypes[cancelLift] || 'syscon_msgs/string_srv',
        cancelArgs: { data: '' },
        topic: null,
        topicType: null,
        commands: { stop: 0, up: 1, down: 2 }
      };
    } else if (hasTopic(topicLift)) {
      profile.lift.topic = topicLift;
    }

    if (hasService(modernTask)) {
      profile.task = {
        variant: 'spx',
        goalName: modernTask,
        goalType: serviceTypes[modernTask] || 'spx_task_msgs/TaskGoal',
        pauseName: `${ns}/spx/task/pause`,
        pauseType: 'spx_task_msgs/TaskPause',
        pauseArgs: {},
        resumeName: `${ns}/spx/task/resume`,
        resumeType: 'spx_task_msgs/TaskResume',
        resumeArgs: {},
        cancelName: `${ns}/spx/task/cancel`,
        cancelType: 'spx_task_msgs/TaskCancel',
        cancelArgs: {},
        feedbackName: `${ns}/spx/task/feedback`,
        feedbackType: 'spx_task_msgs/TaskFeedback',
        resultName: `${ns}/spx/task/result`,
        resultType: 'spx_task_msgs/TaskResult'
      };
    } else if (hasService(legacyTask)) {
      profile.task.goalType = serviceTypes[legacyTask] || profile.task.goalType;
      const localFeedback = `${ns}/TARU/feedback`;
      const localResult = `${ns}/TARU/result`;
      const bridgeFeedback = `/dt/ros/task/${rid}/feedback`;
      const bridgeResult = `/dt/ros/task/${rid}/result`;
      profile.task.feedbackName = hasTopic(localFeedback) ? localFeedback : bridgeFeedback;
      profile.task.resultName = hasTopic(localResult) ? localResult : bridgeResult;
      profile.task.stateName = hasTopic(`${ns}/taru_state`) ? `${ns}/taru_state` : null;
      profile.task.stateType = profile.task.stateName ? 'std_msgs/Int32' : null;
    }

    return profile;
  },

  mapSaveRequest(profile) {
    const map = profile?.map || {};
    return map.saveUsesName ? { data: map.baseName || 'map' } : { save_in_db: true };
  },

  mapPoseGraphSaveRequest(profile) {
    const map = profile?.map || {};
    const directory = String(map.directory || '/home/syscon/ROS_DB/map').replace(/\/$/, '');
    return { filename: `${directory}/${map.baseName || 'map'}` };
  },

  mapReloadRequest(profile, yamlPath) {
    const type = String(profile?.map?.reloadType || '');
    if (type === 'map_server/LoadMap') return { map_url: yamlPath };
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
