// TaskSender RouteNavigation(48) / spx.route_contract.v1,v2 contract adapter.
// Evidence: R_025 task_sender_compatibility, spx_route_contract parser/validator.
const Ros2Route = {
  TYPE: 48,
  stable(value) {
    if (Array.isArray(value)) return value.map(item => this.stable(item));
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, this.stable(value[key])]));
    return value;
  },
  clone(value) { return JSON.parse(JSON.stringify(value)); },
  finite(value, label) {
    const number = Number(value);
    if (value === null || typeof value === 'boolean' || String(value).trim() === '' || !Number.isFinite(number)) throw new Error(`${label}: 유한한 숫자가 필요합니다.`);
    return number;
  },
  text(value, label) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}: 값을 입력하세요.`);
    return value.trim();
  },
  identity(robot, orderId, actionId, first, last) {
    const bytes = value => Array.from(String(value)).reduce((n, char) => n + (char.codePointAt(0) > 65535 ? 4 : char.codePointAt(0) > 2047 ? 3 : char.codePointAt(0) > 127 ? 2 : 1), 0);
    return 'spx-route-contract-id-v1|' + [robot.manufacturer, robot.serial_number, orderId, actionId, actionId]
      .map(value => `${bytes(value)}:${value}|`).join('') + `${first}|${last}`;
  },
  build(options = {}) {
    const schema = options.schema || 'spx.route_contract.v2';
    const planned = options.pathSource === 'ROBOT_FREESPACE';
    if (planned && schema !== 'spx.route_contract.v2') throw new Error('목적지 계획은 route contract v2가 필요합니다.');
    const points = (options.points || []).map((p, i) => ({ x: this.finite(p.x, `점 ${i + 1} X`), y: this.finite(p.y, `점 ${i + 1} Y`), yaw: this.finite(p.yaw ?? p.theta ?? 0, `점 ${i + 1} 방향`) }));
    if (points.length < (planned ? 1 : 2)) throw new Error(planned ? '목적지 좌표가 필요합니다.' : '시작점과 종료점을 포함한 두 개 이상의 점이 필요합니다.');
    const nurbs = options.geometry === 'NURBS';
    if (nurbs && schema !== 'spx.route_contract.v2') throw new Error('NURBS 곡선은 v2만 지원합니다.');
    const route = { schema, route_id: this.text(options.routeId, 'Route ID'), mode: 'LINE_AGV',
      map_id: this.text(options.mapId, 'Map ID'), frame_id: this.text(options.frameId || 'map', 'Frame'),
      final_goal_node_id: '', nodes: [], edges: [], events: [] };
    const coordinateNodes = nurbs ? [points[0], points[points.length - 1]] : points;
    if (planned) coordinateNodes.unshift(null);
    coordinateNodes.forEach((pose, i) => {
      const node = { node_id: `N${i}`, sequence_id: i * 2, released: true,
        type: i === 0 ? 'START' : i === coordinateNodes.length - 1 ? 'ROUTE_END' : 'REQUIRED_VIA' };
      if (pose) node.pose = { ...pose };
      if (schema.endsWith('.v2')) {
        node.pose_source = pose ? 'NODE_POSITION' : 'CURRENT_ROBOT_POSE';
        node.vda5050 = { node_id: node.node_id, sequence_id: node.sequence_id };
      }
      route.nodes.push(node);
    });
    route.final_goal_node_id = route.nodes[route.nodes.length - 1].node_id;
    const left = this.finite(options.leftWidth ?? 0.5, '경로 좌측 폭');
    const right = this.finite(options.rightWidth ?? 0.5, '경로 우측 폭');
    const backward = options.direction === 'BACKWARD';
    for (let i = 0; i < route.nodes.length - 1; i++) {
      const start = route.nodes[i], end = route.nodes[i + 1];
      const edge = { edge_id: `E${i}`, sequence_id: i * 2 + 1, released: true,
        start_node_id: start.node_id, end_node_id: end.node_id,
        corridor: { left_width: left, right_width: right }, obstacle_policy: options.obstaclePolicy || 'STOP' };
      if (schema.endsWith('.v2')) {
        edge.path_source = planned ? 'ROBOT_FREESPACE' : 'PROVIDED_TRAJECTORY';
        edge.reverse_allowed = backward; edge.motion_direction = backward ? 'BACKWARD' : 'FORWARD';
        edge.stop_policy = i === route.nodes.length - 2 ? 'ROUTE_END' : 'PASS_THROUGH';
        edge.vda5050 = { edge_id: edge.edge_id, sequence_id: edge.sequence_id,
          start_node_id: start.node_id, start_node_sequence_id: start.sequence_id,
          end_node_id: end.node_id, end_node_sequence_id: end.sequence_id };
        if (planned) edge.planner_request = { start_pose_source: start.pose_source, goal_node_id: end.node_id,
          backend: 'NAV2_FREESPACE', planner_id: options.plannerId || '' };
      }
      if (!planned) {
        edge.geometry_type = nurbs ? 'NURBS' : 'LINE';
        const control = nurbs ? points : [start.pose, end.pose];
        edge.control_points = control.map(p => ({ x: p.x, y: p.y, ...(nurbs || schema.endsWith('.v1') ? { weight: 1 } : {}) }));
        if (nurbs) {
          const degree = Number(options.degree ?? 3);
          edge.degree = degree;
          edge.knot_vector = options.knots || Array.from({ length: control.length + degree + 1 }, (_, index) =>
            index <= degree ? 0 : index >= control.length ? 1 : (index - degree) / (control.length - degree));
        } else if (schema.endsWith('.v1')) { edge.degree = 1; edge.knot_vector = []; }
      }
      route.edges.push(edge);
    }
    if (schema.endsWith('.v2')) {
      route.path_source = planned ? 'ROBOT_FREESPACE' : 'PROVIDED_TRAJECTORY';
      route.source_system = 'vda5050.edge_navigation';
      route.source_robot = options.robot || { manufacturer: 'SysconRobotics', serial_number: options.robotId || '' };
      route.contract_revision = 0;
      route.correlation = { order_id: options.taskId || route.route_id, order_update_id: 0, action_id: options.actionId || 'route', command_id: options.actionId || 'route' };
      route.contract_id = this.identity(route.source_robot, route.correlation.order_id, route.correlation.action_id, 1, route.edges[route.edges.length - 1].sequence_id);
      if (options.plannerId) route.planner_id = options.plannerId;
      if (options.controllerId) route.controller_id = options.controllerId;
      if (options.localPlannerId) route.local_planner_id = options.localPlannerId;
    }
    this.validate(route);
    return route;
  },
  parse(value) {
    let route;
    try { route = typeof value === 'string' ? JSON.parse(value) : this.clone(value); }
    catch (error) { throw new Error('route_contract_json이 올바른 JSON이 아닙니다.'); }
    this.validate(route);
    return route;
  },
  validate(route) {
    if (!route || typeof route !== 'object' || Array.isArray(route)) throw new Error('Route는 JSON object여야 합니다.');
    if (!['spx.route_contract.v1', 'spx.route_contract.v2'].includes(route.schema)) throw new Error('지원되는 route schema는 v1/v2입니다.');
    const v2 = route.schema.endsWith('.v2');
    if (v2) {
      const allowed = new Set(['schema','contract_id','contract_revision','source_system','source_robot','route_id','mode','map_id','frame_id','path_source','planner_id','local_planner_id','controller_id','tracking_profile_id','docking_tracking_mode','docking_target_selection','docking_parameters','docking_transition','docking_approach','correlation','final_goal_node_id','nodes','edges','events']);
      const unknown = Object.keys(route).filter(key => !allowed.has(key));
      if (unknown.length) throw new Error(`v2에서 사용하지 않는 파라미터: ${unknown.join(', ')}`);
    }
    ['route_id', 'map_id', 'frame_id', 'final_goal_node_id'].forEach(key => this.text(route[key], key));
    if (route.mode !== 'LINE_AGV') throw new Error('현재 로봇 계약은 LINE_AGV mode만 지원합니다.');
    if (!Array.isArray(route.nodes) || !Array.isArray(route.edges) || !route.edges.length || route.nodes.length !== route.edges.length + 1) throw new Error('경로는 nodes=edges+1인 하나의 연결된 chain이어야 합니다.');
    const ids = new Set(), edgeIds = new Set();
    route.nodes.forEach((node, i) => {
      this.text(node.node_id, 'node_id');
      if (ids.has(node.node_id) || node.sequence_id !== i * 2 || node.released !== true) throw new Error('Node ID·sequence·released 값을 확인하세요.');
      ids.add(node.node_id);
      if (node.type !== (i === 0 ? 'START' : i === route.nodes.length - 1 ? 'ROUTE_END' : 'REQUIRED_VIA')) throw new Error('Node type은 START→REQUIRED_VIA→ROUTE_END 순서여야 합니다.');
      if (v2 && node.pose_source === 'CURRENT_ROBOT_POSE') {
        if (i !== 0 || node.pose) throw new Error('현재 로봇 위치는 pose 없는 시작 Node에서만 사용합니다.');
      } else {
        if (!node.pose) throw new Error('Node 좌표가 필요합니다.');
        ['x', 'y', 'yaw'].forEach(key => { if (typeof node.pose[key] !== 'number') throw new Error('pose.' + key + '는 JSON number여야 합니다.'); this.finite(node.pose[key], 'pose.' + key); });
        if (v2 && node.pose_source !== 'NODE_POSITION') throw new Error('잘못된 pose_source입니다.');
      }
      if (v2 && (!node.vda5050?.node_id || node.vda5050.sequence_id !== node.sequence_id)) throw new Error('Node VDA identity가 필요합니다.');
    });
    if (route.final_goal_node_id !== route.nodes[route.nodes.length - 1].node_id) throw new Error('최종 목표는 마지막 Node여야 합니다.');
    const sources = [];
    route.edges.forEach((edge, i) => {
      this.text(edge.edge_id, 'edge_id');
      if (edgeIds.has(edge.edge_id) || edge.sequence_id !== i * 2 + 1 || edge.released !== true || edge.start_node_id !== route.nodes[i].node_id || edge.end_node_id !== route.nodes[i + 1].node_id) throw new Error('Edge ID·순서·연결이 올바르지 않습니다.');
      edgeIds.add(edge.edge_id);
      if (!['STOP', 'ROLLOUT_WITHIN_CORRIDOR'].includes(edge.obstacle_policy)) throw new Error('지원되지 않는 obstacle_policy입니다.');
      if (!edge.corridor || Number(edge.corridor.left_width) <= 0 || Number(edge.corridor.right_width) <= 0) throw new Error('각 corridor 폭은 0보다 커야 합니다.');
      this.finite(edge.corridor.left_width, 'left_width'); this.finite(edge.corridor.right_width, 'right_width');
      const provided = !v2 || edge.path_source === 'PROVIDED_TRAJECTORY';
      if (provided) {
        if (edge.planner_request || !Array.isArray(edge.control_points) || edge.control_points.length < 2) throw new Error('지정 경로에는 control_points가 필요합니다.');
        if (!['LINE', 'POLYLINE', 'NURBS'].includes(edge.geometry_type) || (v2 && edge.geometry_type === 'POLYLINE') || (!v2 && edge.geometry_type === 'NURBS')) throw new Error('지원되지 않는 경로 geometry입니다.');
        if (edge.geometry_type === 'LINE' && edge.control_points.length !== 2) throw new Error('LINE은 정확히 두 개의 제어점을 사용합니다.');
        edge.control_points.forEach(p => { if (typeof p.x !== 'number' || typeof p.y !== 'number') throw new Error('control point는 JSON number여야 합니다.'); if (v2 && edge.geometry_type === 'LINE' && p.weight !== undefined) throw new Error('v2 LINE 제어점은 weight 필드를 사용하지 않습니다.'); this.finite(p.x, 'control X'); this.finite(p.y, 'control Y'); if (p.weight !== undefined && this.finite(p.weight, 'weight') <= 0) throw new Error('NURBS weight는 양수여야 합니다.'); });
        const first = edge.control_points[0], last = edge.control_points[edge.control_points.length - 1];
        const start = route.nodes[i].pose, end = route.nodes[i + 1].pose;
        if (!start || !end || Math.hypot(first.x - start.x, first.y - start.y) > 0.001 || Math.hypot(last.x - end.x, last.y - end.y) > 0.001 || !edge.control_points.some(p => Math.hypot(p.x - first.x, p.y - first.y) > 0.000001)) throw new Error('제어점 시작/끝은 Node 위치와 일치하고 경로 길이는 양수여야 합니다.');
        if (edge.geometry_type === 'NURBS') {
          if (!Number.isInteger(edge.degree) || edge.degree < 1 || edge.degree >= edge.control_points.length || edge.knot_vector?.length !== edge.control_points.length + edge.degree + 1) throw new Error('NURBS degree/knot 개수가 올바르지 않습니다.');
          edge.knot_vector.forEach((v, j) => { this.finite(v, 'knot'); if (j && v < edge.knot_vector[j - 1]) throw new Error('Knot은 오름차순이어야 합니다.'); });
          if (edge.knot_vector[edge.control_points.length] <= edge.knot_vector[edge.degree]) throw new Error('NURBS knot domain의 길이는 양수여야 합니다.');
        } else if (v2 && (edge.degree !== undefined || edge.knot_vector !== undefined)) throw new Error('v2 LINE은 degree/knot 필드를 사용하지 않습니다.');
      } else {
        if (!['ROBOT_FREESPACE', 'ROBOT_GRAPH_CONSTRAINED'].includes(edge.path_source) || ['geometry_type', 'degree', 'knot_vector', 'control_points'].some(key => edge[key] !== undefined)) throw new Error('로봇 계획 경로에 지정 geometry를 혼합할 수 없습니다.');
        const request = edge.planner_request;
        if (!request || request.goal_node_id !== edge.end_node_id || request.start_pose_source !== route.nodes[i].pose_source || request.backend !== (edge.path_source === 'ROBOT_FREESPACE' ? 'NAV2_FREESPACE' : 'SITE_GRAPH')) throw new Error('planner_request가 segment와 일치하지 않습니다.');
      }
      if (v2) {
        sources.push(edge.path_source);
        if (!['FORWARD', 'BACKWARD'].includes(edge.motion_direction) || typeof edge.reverse_allowed !== 'boolean' || (edge.motion_direction === 'BACKWARD' && !edge.reverse_allowed)) throw new Error('주행 방향과 reverse_allowed를 확인하세요.');
        if (!['PASS_THROUGH', 'STOP_POINT', 'PRECISE_STOP', 'ROUTE_END'].includes(edge.stop_policy)) throw new Error('stop_policy를 확인하세요.');
        const identity = edge.vda5050;
        if (!identity || identity.edge_id !== edge.edge_id || identity.sequence_id !== edge.sequence_id || identity.start_node_id !== route.nodes[i].vda5050.node_id || identity.end_node_id !== route.nodes[i + 1].vda5050.node_id || identity.start_node_sequence_id !== i * 2 || identity.end_node_sequence_id !== i * 2 + 2) throw new Error('Edge VDA identity가 일치하지 않습니다.');
      }
    });
    if (v2) {
      if (!Array.isArray(route.events) || route.events.length) throw new Error('현재 v2 계약은 events가 비어 있어야 합니다. 도킹 전환은 docking_transition을 사용하세요.');
      const aggregate = sources.every(x => x === sources[0]) ? sources[0] : 'MIXED';
      if (route.path_source !== aggregate) throw new Error('전체 path_source와 segment source가 일치하지 않습니다.');
      this.text(route.source_system, 'source_system'); this.text(route.source_robot?.manufacturer, 'manufacturer'); this.text(route.source_robot?.serial_number, 'serial_number');
      this.text(route.correlation?.order_id, 'order_id'); this.text(route.correlation?.command_id, 'command_id');
      if (!Number.isInteger(route.contract_revision) || route.contract_revision < 0 || route.contract_revision !== route.correlation.order_update_id) throw new Error('contract revision이 일치하지 않습니다.');
      const c = route.correlation;
      const expected = this.identity(route.source_robot, c.order_id, c.action_id || '', route.edges[0].sequence_id, route.edges[route.edges.length - 1].sequence_id);
      if (route.contract_id !== expected) throw new Error('contract_id와 correlation이 일치하지 않습니다.');
    }
    return route;
  },
  action(route, name = 'RouteNavigation', extras = {}) {
    const params = [{ param_name: 'route_contract_json', type: 'string', value: JSON.stringify(this.parse(route)) }];
    if (extras.maximumSpeed !== undefined && extras.maximumSpeed !== '') {
      const speed = this.finite(extras.maximumSpeed, 'maximum_speed_mps');
      if (speed <= 0) throw new Error('maximum_speed_mps는 양수여야 합니다.');
      params.push({ param_name: 'maximum_speed_mps', type: 'float', value: String(speed) });
    }
    return { actionType: '0x30', action_type: 48, args: extras.dockingArgs || [], action_args: extras.dockingArgs || [],
      params,
      summary: `${name} · ${route.path_source || 'PROVIDED_TRAJECTORY'} · ${route.edges.length} 구간` };
  },
  bind(action, context) {
    const params = action.action_params || action.params || [];
    const carriers = params.filter(p => p.param_name === 'route_contract_json');
    if (carriers.length !== 1 || carriers[0].type !== 'string') throw new Error('RouteNavigation은 하나의 string route_contract_json이 필요합니다.');
    const route = this.parse(carriers[0].value);
    const allowed = new Set(['route_contract_json', 'maximum_speed_mps', 'start_heading_policy.enabled', 'start_heading_policy.source', 'start_heading_policy.start_align_threshold_rad', 'start_heading_policy.complete_tolerance_rad', 'start_heading_policy.max_angular_speed', 'start_heading_policy.timeout_sec']);
    const unknown = params.filter(param => !allowed.has(param.param_name) || (route.schema.endsWith('.v2') && param.param_name.startsWith('start_heading_policy.'))).map(param => param.param_name);
    if (unknown.length) throw new Error(`ROS2 RouteNavigation에서 소비하지 않는 파라미터: ${unknown.join(', ')} · 변환 검토가 필요합니다.`);
    const seen = new Set();
    for (const param of params) { if (seen.has(param.param_name)) throw new Error(`중복 파라미터: ${param.param_name}`); seen.add(param.param_name); }
    const acsCarriers = (action.acs_data || []).filter(value => typeof value === 'string' && value.startsWith('route_contract_json='));
    for (const carrier of acsCarriers) {
      if (JSON.stringify(this.stable(this.parse(carrier.slice('route_contract_json='.length)))) !== JSON.stringify(this.stable(route))) throw new Error('route_contract_json과 acs_data 경로가 다릅니다.');
    }
    if (context.schema && route.schema !== context.schema) throw new Error(`Route schema ${route.schema}와 runtime ${context.schema}가 다릅니다.`);
    if (context.mapId && route.map_id !== context.mapId) throw new Error(`Route Map ${route.map_id}와 현재 Map ${context.mapId}가 다릅니다.`);
    if (context.frameId && route.frame_id !== context.frameId) throw new Error('Route frame_id가 현재 runtime과 다릅니다.');
    if (route.schema.endsWith('.v2')) {
      route.source_robot = context.robot || route.source_robot;
      const id = this.text(action.action_id, 'action_id');
      route.correlation = { order_id: this.text(context.taskId, 'task_id'), order_update_id: 0, action_id: id, command_id: id };
      route.contract_revision = 0;
      route.contract_id = this.identity(route.source_robot, context.taskId, id, route.edges[0].sequence_id, route.edges[route.edges.length - 1].sequence_id);
    }
    this.validate(route); carriers[0].value = JSON.stringify(route);
    if (acsCarriers.length) action.acs_data = action.acs_data.map(value => typeof value === 'string' && value.startsWith('route_contract_json=') ? `route_contract_json=${carriers[0].value}` : value);
    return action;
  },
  convertLegacy(action, context = {}) {
    const type = Number(action.action_type ?? action.actionType);
    if (![1, 21].includes(type)) throw new Error('자동 경로 변환은 WayPoint / TrajectoryFollowing만 지원합니다.');
    const args = action.action_args || action.args || [];
    if (type === 1 && args.length !== 3) throw new Error('WayPoint 좌표 형식이 올바르지 않습니다.');
    if (type === 21 && (args.length < 5 || args.length % 2 !== 1)) throw new Error('Trajectory 경로점이 부족합니다.');
    const points = type === 1 ? [{ x: args[0], y: args[1], yaw: args[2] }]
      : args.slice(0, -1).reduce((result, _value, i, values) => {
        if (i % 2 === 0) result.push({ x: values[i], y: values[i + 1], yaw: i === values.length - 2 ? args[args.length - 1] : 0 });
        return result;
      }, []);
    const params = action.params || action.action_params || [];
    const value = key => params.find(p => p.param_name === key)?.value;
    const backward = ['true', '1'].includes(String(value('backward_driving'))) || Number(value('lane_direction')) === 3;
    const mapped = new Set(['backward_driving', 'lane_name', 'max_trans_vel']);
    if (value('lane_direction') === undefined || [0, 3].includes(Number(value('lane_direction')))) mapped.add('lane_direction');
    const route = this.build({ ...context, routeId: String(value('lane_name') || action.name || action.action_id || 'converted-route'), points,
      pathSource: type === 1 ? 'ROBOT_FREESPACE' : 'PROVIDED_TRAJECTORY', direction: backward ? 'BACKWARD' : 'FORWARD' });
    return { action: { ...this.action(route, 'RouteNavigation', { maximumSpeed: value('max_trans_vel') }), name: action.name || 'RouteNavigation', missionId: action.missionId },
      original: this.clone(action), unmapped: params.filter(p => !mapped.has(p.param_name)).map(p => p.param_name) };
  },
  sampleCurve(edge, samples = 60) {
    const points = edge.control_points, degree = edge.degree, knots = edge.knot_vector;
    const n = points.length - 1, lower = knots[degree], upper = knots[n + 1];
    return Array.from({ length: samples + 1 }, (_, sample) => {
      const u = lower + (upper - lower) * sample / samples;
      let span = degree;
      if (sample === samples) span = n;
      else while (span < n && u >= knots[span + 1]) span++;
      const work = Array.from({ length: degree + 1 }, (_value, j) => {
        const point = points[span - degree + j], weight = point.weight ?? 1;
        return [point.x * weight, point.y * weight, weight];
      });
      for (let r = 1; r <= degree; r++) for (let j = degree; j >= r; j--) {
        const i = span - degree + j, denominator = knots[i + degree - r + 1] - knots[i];
        const alpha = denominator ? (u - knots[i]) / denominator : 0;
        work[j] = work[j].map((value, k) => (1 - alpha) * work[j - 1][k] + alpha * value);
      }
      return { x: work[degree][0] / work[degree][2], y: work[degree][1] / work[degree][2], theta: 0 };
    });
  },
  preview(action) {
    const carrier = (action.action_params || action.params || []).find(p => p.param_name === 'route_contract_json');
    if (!carrier) return [];
    try {
      const route = this.parse(carrier.value);
      const points = [];
      route.edges.forEach((edge, i) => {
        const segment = edge.geometry_type === 'NURBS' ? this.sampleCurve(edge) : [route.nodes[i].pose, route.nodes[i + 1].pose].filter(Boolean).map(pose => ({ x: pose.x, y: pose.y, theta: pose.yaw || 0 }));
        points.push(...(i && points.length && segment.length > 1 ? segment.slice(1) : segment));
      });
      return points;
    }
    catch (error) { return []; }
  }
};
if (typeof module !== 'undefined' && module.exports) module.exports = Ros2Route;

// Editor uses product names; the protocol JSON remains available for imported
// hybrid/docking contracts without discarding their additional reviewed fields.
const Ros2RouteEditor = {
  render(argsBox, paramsBox, slot, saved = null, extras = {}) {
    const context = slot?.compatibilityProfile?.task?.routeContext || {};
    let original = null;
    if (saved) { try { original = Ros2Route.parse(saved); } catch (error) { /* show invalid JSON for repair */ } }
    const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    argsBox.innerHTML = `<div class="ros2-route-editor">
      <label>경로 이름 <input id="route-id" value="${esc(original?.route_id || `route_${Date.now()}`)}"></label>
      <label>입력 방식 <select id="route-path-source">
        <option value="ROBOT_FREESPACE">목적지 계획 · 기존 WayPoint</option>
        <option value="PROVIDED_TRAJECTORY">지정 경로 · 기존 TrajectoryFollowing</option>
        <option value="NURBS">NURBS 곡선 · 제어점 입력</option>
      </select></label>
      <label>계약 버전 <select id="route-schema"><option value="spx.route_contract.v2">v2 · 계획 / 지정 / 곡선</option><option value="spx.route_contract.v1">v1 · 지정 경로</option></select></label>
      <label>지도 ID <input id="route-map-id" value="${esc(original?.map_id || context.mapId || '')}"></label>
      <label>좌표계 <input id="route-frame-id" value="${esc(original?.frame_id || context.frameId || 'map')}"></label>
      <label>좌측 / 우측 허용 폭 (m)
        <input id="route-left-width" type="number" min="0.01" step="0.01" value="${esc(original?.edges?.[0]?.corridor?.left_width ?? 0.5)}">
        <input id="route-right-width" type="number" min="0.01" step="0.01" value="${esc(original?.edges?.[0]?.corridor?.right_width ?? 0.5)}"></label>
      <label>장애물 정책 <select id="route-obstacle-policy"><option value="STOP">정지</option><option value="ROLLOUT_WITHIN_CORRIDOR">허용 폭 안에서 회피</option></select></label>
      <label>주행 방향 <select id="route-direction"><option value="FORWARD">전진</option><option value="BACKWARD">후진</option></select></label>
      <label>최대 선속도 (m/s) · 비우면 로봇 설정 사용 <input id="route-maximum-speed" type="number" min="0.01" step="0.01" placeholder="maximum_speed_mps"></label>
      <details><summary>도킹 연결 · RouteNavigation의 새 입력</summary>
        <label><input id="route-docking-enabled" type="checkbox"> 이 경로에 도킹 입력 포함</label>
        <label>충전 도킹 <select id="route-is-charge"><option value="0">일반 도킹</option><option value="1">충전 도킹</option></select></label>
        <label>도킹 방향 <select id="route-dock-direction"><option value="1">전방</option><option value="-1">후방</option><option value="2">좌측</option><option value="3">우측</option></select></label>
        <label>인식 방식 <select id="route-scan-type"><option value="4">Target / Rack</option><option value="5">ArUco</option><option value="7">Direct</option><option value="1">L</option><option value="2">LV</option><option value="3">Cradle</option><option value="6">ML-LV</option></select></label>
        <p>프로파일·도킹 전환·오프셋은 상세 JSON의 docking_target_selection / docking_parameters / docking_transition에서 지정합니다. 기존 target_cfg 이름을 자동으로 재사용하지 않습니다.</p>
      </details>
      <label>경로점 / 제어점 · 각 줄에 x, y, yaw(rad)
        <textarea id="route-points" rows="6" placeholder="목적지 계획: 목표점 한 개 이상&#10;지정 경로: 시작점과 종료점 두 개 이상"></textarea></label>
      <div class="action-position-helpers">
        <button type="button" id="route-pick-map" class="btn btn-small">지도에서 점 추가</button>
        <button type="button" id="route-add-current" class="btn btn-small">현재 위치 추가</button>
        <button type="button" id="route-validate" class="btn btn-small">입력 검증</button>
        <button type="button" id="route-node-params" class="btn btn-small">ROS2 속도·플래너 Params</button>
      </div>
      <p id="route-editor-status" role="status"></p>
      <p class="ros-info-hint">목적지 계획은 실행 시 현재 로봇 위치를 시작점으로 사용합니다. 최대 선속도는 maximum_speed_mps를 사용하며, 나머지 속도·허용 오차는 로봇의 ROS2 설정을 사용합니다. 실행 전 지도·경로 폭·주행 방향을 확인하세요.</p>
    </div>`;
    paramsBox.innerHTML = `<details class="ros2-route-json"><summary>상세 RouteNavigation JSON · 도킹/혼합 경로 보존</summary>
      <textarea id="action-param-0" data-name="route_contract_json" data-type="string" rows="12">${esc(saved || '')}</textarea>
      <button type="button" id="route-apply-json" class="btn btn-small">JSON 검증</button></details>`;
    const get = id => document.getElementById(id);
    get('route-schema').value = original?.schema || context.schema || 'spx.route_contract.v2';
    get('route-path-source').value = original?.edges?.some(e => e.geometry_type === 'NURBS') ? 'NURBS'
      : original?.path_source === 'ROBOT_FREESPACE' ? 'ROBOT_FREESPACE' : original ? 'PROVIDED_TRAJECTORY' : 'ROBOT_FREESPACE';
    get('route-direction').value = original?.edges?.[0]?.motion_direction || 'FORWARD';
    get('route-obstacle-policy').value = original?.edges?.[0]?.obstacle_policy || 'STOP';
    const originalPoints = original?.edges?.some(e => e.geometry_type === 'NURBS')
      ? original.edges[0].control_points.map((p, i, list) => ({ ...p, yaw: i === list.length - 1 ? original.nodes[original.nodes.length - 1].pose.yaw : i === 0 ? original.nodes[0].pose.yaw : 0 }))
      : original?.nodes?.filter(n => n.pose).map(n => n.pose) || [];
    get('route-maximum-speed').value = extras.maximumSpeed ?? '';
    if (context.maximumSpeed) { get('route-maximum-speed').max = String(context.maximumSpeed); get('route-maximum-speed').placeholder = `로봇 설정 사용 · 상한 ${context.maximumSpeed} m/s`; }
    get('route-docking-enabled').checked = extras.dockingArgs?.length === 3;
    if (extras.dockingArgs?.length === 3) {
      ['route-is-charge', 'route-dock-direction', 'route-scan-type'].forEach((id, i) => { get(id).value = extras.dockingArgs[i]; });
    }
    get('route-points').value = originalPoints.map(p => `${p.x}, ${p.y}, ${p.yaw || 0}`).join('\n');
    let formCompatible = true;
    if (original) {
      try {
        const first = original.edges[0];
        const basic = Ros2Route.build({ schema: original.schema, routeId: original.route_id, mapId: original.map_id, frameId: original.frame_id,
          points: originalPoints, pathSource: original.path_source, geometry: first.geometry_type,
          leftWidth: first.corridor.left_width, rightWidth: first.corridor.right_width, direction: first.motion_direction,
          obstaclePolicy: first.obstacle_policy, robot: original.source_robot });
        formCompatible = JSON.stringify(Ros2Route.stable({ nodes: basic.nodes, edges: basic.edges })) === JSON.stringify(Ros2Route.stable({ nodes: original.nodes, edges: original.edges }));
      } catch (error) { formCompatible = false; }
    }
    let formChanged = false;
    const build = () => {
      if (original && !formCompatible) {
        throw new Error('혼합 경로 또는 가중 NURBS는 상세 JSON에서 수정하세요. 기존 구간 속성을 보존하기 위해 단순 경로 폼 변환을 실행하지 않았습니다.');
      }
      const points = get('route-points').value.trim().split(/\n/).filter(Boolean).map((line, i) => {
        const values = line.trim().split(/[\s,]+/);
        if (values.length < 2 || values.length > 3) throw new Error(`점 ${i + 1}: x, y, yaw 형식을 확인하세요.`);
        return { x: Ros2Route.finite(values[0], 'X'), y: Ros2Route.finite(values[1], 'Y'), yaw: Ros2Route.finite(values[2] ?? 0, 'yaw') };
      });
      const path = get('route-path-source').value;
      const route = Ros2Route.build({ schema: get('route-schema').value, routeId: get('route-id').value,
        mapId: get('route-map-id').value, frameId: get('route-frame-id').value, points,
        pathSource: path === 'NURBS' ? 'PROVIDED_TRAJECTORY' : path, geometry: path === 'NURBS' ? 'NURBS' : 'LINE',
        leftWidth: get('route-left-width').value, rightWidth: get('route-right-width').value,
        direction: get('route-direction').value, obstaclePolicy: get('route-obstacle-policy').value,
        robotId: slot?.robotId || '', robot: context.robot });
      if (original) for (const key of ['planner_id', 'local_planner_id', 'controller_id', 'tracking_profile_id',
        'docking_tracking_mode', 'docking_target_selection', 'docking_parameters', 'docking_transition', 'docking_approach', 'start_heading_policy']) {
        if (original[key] !== undefined) route[key] = Ros2Route.clone(original[key]);
      }
      Ros2Route.validate(route);
      get('action-param-0').value = JSON.stringify(route, null, 2);
      get('route-editor-status').textContent = `입력 검증 완료 · ${route.edges.length} 구간 · ${route.map_id}`;
      return route;
    };
    this.extras = () => ({ maximumSpeed: get('route-maximum-speed').value,
      dockingArgs: get('route-docking-enabled').checked ? [Number(get('route-is-charge').value), Number(get('route-dock-direction').value), Number(get('route-scan-type').value)] : [] });
    this.read = () => formChanged || !get('action-param-0').value.trim() ? build() : Ros2Route.parse(get('action-param-0').value);
    argsBox.querySelectorAll('input,select,textarea').forEach(input => input.addEventListener('input', () => {
      if (!['route-maximum-speed', 'route-docking-enabled', 'route-is-charge', 'route-dock-direction', 'route-scan-type'].includes(input.id)) formChanged = true;
    }));
    get('route-validate').onclick = () => { try { if (formChanged || !saved) build(); else this.read(); } catch (error) { get('route-editor-status').textContent = error.message; } };
    get('route-apply-json').onclick = () => { try { const json = get('action-param-0').value; Ros2Route.parse(json); this.render(argsBox, paramsBox, slot, json, this.extras()); get('route-editor-status').textContent = 'JSON 검증 완료'; } catch (error) { get('route-editor-status').textContent = error.message; } };
    const add = (x, y, yaw) => { get('route-points').value += `${get('route-points').value ? '\n' : ''}${x}, ${y}, ${yaw}`; formChanged = true; };
    get('route-pick-map').onclick = () => {
      if (typeof RosManager !== 'undefined') RosManager._enterWaypointSelectMode((x, y, yaw) => add(x, y, yaw));
    };
    get('route-add-current').onclick = () => { const p = slot?.pose; if (p) add(p.x, p.y, p.yaw || 0); else get('route-editor-status').textContent = '현재 로봇 위치가 수신되지 않았습니다.'; };
    get('route-node-params').onclick = () => { if (typeof ParamTuning !== 'undefined') ParamTuning.showModal(); };
  }
};
if (typeof module !== 'undefined' && module.exports) module.exports.Editor = Ros2RouteEditor;
