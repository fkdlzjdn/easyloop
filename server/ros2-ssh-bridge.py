"""ROS2 transport for EasyLoop. Executed in memory, with no robot installation.

Only this connection's subscriptions, publishers and action goals are owned here.
ROS1-shaped rosapi parameter calls use explicit /node::parameter identifiers.
"""
import base64
import json
import math
import os
import queue
import sys
import threading
import time

import rclpy
from rclpy.action import ActionClient
from rclpy.action.graph import get_action_names_and_types
from rclpy.parameter import Parameter, parameter_value_to_python
from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy
from rosidl_runtime_py.convert import message_to_ordereddict
from rosidl_runtime_py.set_message import set_message_fields
from rosidl_runtime_py.utilities import get_action, get_message, get_service


def json_safe(value):
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {key: json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    if hasattr(value, 'tolist'):
        return json_safe(value.tolist())
    if isinstance(value, (bytes, bytearray)):
        return list(value)
    return value


def ros2_fields(value):
    """Convert the legacy header/time fields still sent by bundled ROSLIB."""
    if isinstance(value, list):
        return [ros2_fields(item) for item in value]
    if not isinstance(value, dict):
        return value
    result = {key: ros2_fields(item) for key, item in value.items()}
    if 'secs' in result or 'nsecs' in result:
        result['sec'] = result.pop('secs', result.get('sec', 0))
        result['nanosec'] = result.pop('nsecs', result.get('nanosec', 0))
    if isinstance(result.get('header'), dict):
        result['header'].pop('seq', None)
    return result


def graph_type(entries, name):
    types = next((types for endpoint, types in entries if endpoint == name), [])
    if len(types) > 1:
        raise ValueError('Ambiguous ROS2 endpoint type: ' + name)
    return types[0] if types else ''


def subscription_qos(infos, latched=False):
    # Use the publisher's offered policies; a topic name alone does not imply
    # transient_local (the Mapping publisher can be volatile).
    reliability = ReliabilityPolicy.RELIABLE
    durability = DurabilityPolicy.TRANSIENT_LOCAL if latched else DurabilityPolicy.VOLATILE
    if infos:
        reliability = (ReliabilityPolicy.BEST_EFFORT
                       if any(info.qos_profile.reliability == ReliabilityPolicy.BEST_EFFORT for info in infos)
                       else ReliabilityPolicy.RELIABLE)
        durability = (DurabilityPolicy.TRANSIENT_LOCAL
                      if all(info.qos_profile.durability == DurabilityPolicy.TRANSIENT_LOCAL for info in infos)
                      else DurabilityPolicy.VOLATILE)
    return QoSProfile(depth=10, reliability=reliability, durability=durability)


class Bridge:
    def __init__(self, node, emit):
        self.node = node
        self.emit = emit
        self.scope = '/' + os.environ.get('EASYLOOP_ROBOT_ID', os.environ.get('ROS_HOSTNAME', '')).strip('/')
        self.subscriptions = {}
        self.publishers = {}
        self.advertised = {}
        self.clients = {}
        self.pending = []
        self.action_clients = {}
        self.goals = {}
        self.param_jobs = []

    def respond(self, request, values, success=True):
        self.emit({'op': 'service_response', 'service': request.get('service', ''),
                   'id': request.get('id'), 'result': success, 'values': values})

    def require_control(self):
        if os.environ.get('EASYLOOP_CONTROL_ENABLED') != '1':
            raise ValueError('Local ROS2 bringup is not verified; reconnect after starting bringup')
        pid = os.environ.get('EASYLOOP_LOCAL_PID', '')
        if pid:
            try:
                with open('/proc/' + pid + '/cmdline', 'rb') as source:
                    argv = [arg.decode() for arg in source.read().split(b'\x00') if arg]
                if not any(os.path.basename(arg) == 'ros2' and argv[i + 1:i + 3] == ['launch', 'spx_bringup']
                           for i, arg in enumerate(argv)):
                    raise ValueError('Local ROS2 bringup has ended; reconnect')
                namespace = next((arg.split(':=', 1)[1] for arg in argv if arg.startswith('ns:=')), '')
                if namespace and namespace.strip('/') != self.scope.strip('/'):
                    raise ValueError('Local ROS2 namespace has changed; reconnect')
            except OSError as error:
                raise ValueError('Local ROS2 bringup has ended; reconnect') from error

    def error(self, request, error):
        if request.get('op') == 'call_service':
            self.respond(request, {'message': str(error)}, False)
        else:
            self.emit({'op': 'status', 'level': 'error', 'msg': str(error), 'id': request.get('id')})

    def watch(self, future, complete, fail, timeout=10, client=None):
        if len(self.pending) >= 128:
            future.cancel()
            raise ValueError('ROS2 pending request limit reached')
        self.pending.append((future, complete, fail, time.monotonic() + timeout, client))

    def service(self, name, args, complete, fail, type_name=None, timeout=10):
        graph_name = graph_type(self.node.get_service_names_and_types(), name)
        if not graph_name or (type_name and type_name != graph_name):
            raise ValueError('ROS2 service unavailable or type mismatch: ' + name)
        key = (name, graph_name)
        client = self.clients.get(key)
        if client is None:
            if len(self.clients) >= 256:
                raise ValueError('ROS2 service client limit reached')
            client = self.node.create_client(get_service(graph_name), name)
            self.clients[key] = client
        call = get_service(graph_name).Request()
        set_message_fields(call, ros2_fields(args))
        self.watch(client.call_async(call), complete, fail, timeout, client)

    def parameter_address(self, name):
        if '::' in name:
            node, parameter = name.split('::', 1)
        else:
            # Support a legacy /node/parameter only when its node is discovered.
            nodes = [ns.rstrip('/') + '/' + n for n, ns in self.node.get_node_names_and_namespaces()]
            node = next((n for n in sorted(nodes, key=len, reverse=True) if name.startswith(n + '/')), '')
            parameter = name[len(node) + 1:] if node else ''
        if not node.startswith('/') or not parameter or '/' in parameter:
            raise ValueError('ROS2 parameter must be /node::parameter')
        if self.scope != '/' and not node.startswith(self.scope + '/'):
            raise ValueError('Parameter is outside the selected robot namespace')
        return node.rstrip('/'), parameter

    def list_parameters(self, request):
        args = request.get('args') or {}
        prefix = str(args.get('prefix') or '').lower()
        names = sorted({service[:-len('/list_parameters')]
                        for service, types in self.node.get_service_names_and_types()
                        if service.endswith('/list_parameters')
                        and 'rcl_interfaces/srv/ListParameters' in types
                        and (self.scope == '/' or service.startswith(self.scope + '/'))
                        and 'easyloop_bridge_' not in service})
        # A canonical node filter can avoid querying unrelated nodes.
        if '::' in prefix:
            names = [name for name in names if name.lower() == prefix.split('::', 1)[0]]
        job = {'request': request, 'nodes': names, 'active': 0, 'names': [],
               'errors': [], 'prefix': prefix, 'deadline': time.monotonic() + 12}
        self.param_jobs.append(job)

    def parameter(self, request, operation):
        args = request.get('args') or {}
        node, name = self.parameter_address(str(args.get('name') or ''))
        fail = lambda error: self.error(request, error)
        if operation == 'get_param':
            def received(response):
                if not response.values or response.values[0].type == 0:
                    default = args.get('default')
                    self.respond(request, {'value': default if default is not None else 'null'})
                else:
                    self.respond(request, {'value': json.dumps(json_safe(parameter_value_to_python(response.values[0]))),
                                           'type': response.values[0].type})
            self.service(node + '/get_parameters', {'names': [name]}, received, fail)
            return
        value = args.get('value', 'null')
        self.require_control()
        if isinstance(value, str):
            value = json.loads(value)
        # Fetch the declared type so JSON 1 can correctly update a double.
        def current(response):
            if not response.values or response.values[0].type == 0:
                fail(ValueError('Parameter is undeclared: ' + name))
                return
            try:
                kind = response.values[0].type
                typed_value = value
                if kind == 3 and isinstance(value, (int, float)) and not isinstance(value, bool):
                    typed_value = float(value)
                if kind == 8 and isinstance(value, list):
                    typed_value = [float(item) for item in value]
                parameter = Parameter(name, type_=Parameter.Type(kind), value=typed_value).to_parameter_msg()
                def updated(result):
                    failures = [item.reason for item in result.results if not item.successful]
                    if not result.results or failures:
                        fail(ValueError('; '.join(failures) or 'Parameter update rejected'))
                    else:
                        self.respond(request, {'success': True})
                self.service(node + '/set_parameters', {'parameters': [message_to_ordereddict(parameter)]}, updated, fail)
            except Exception as error:
                fail(error)
        self.service(node + '/get_parameters', {'names': [name]}, current, fail)

    def rosapi(self, request):
        operation = request.get('service', '').rsplit('/', 1)[-1]
        args = request.get('args') or {}
        topics = self.node.get_topic_names_and_types()
        services = self.node.get_service_names_and_types()
        if operation == 'runtime_contract':
            names = ['route_contract.schema', 'route_navigation.current_map_id', 'route_contract.frame_id', 'factsheet.maximum_speed']
            def received(response):
                values = {name: parameter_value_to_python(value) for name, value in zip(names, response.values)}
                self.respond(request, {'schema': values.get(names[0]), 'mapId': values.get(names[1]),
                                       'frameId': values.get(names[2]), 'maximumSpeed': values.get(names[3]),
                                       'robot': {'manufacturer': 'SysconRobotics', 'serial_number': self.scope.strip('/')}})
            self.service(self.scope + '/vda_unified_runtime_node/get_parameters', {'names': names}, received,
                         lambda error: self.error(request, error))
            return
        if operation == 'drive_model':
            name = self.scope + '/wheel_driver_node_exe'
            def received(response):
                try:
                    if not response.values or response.values[0].type != 4:
                        raise ValueError('Wheel driver config_file parameter is unavailable')
                    filename = parameter_value_to_python(response.values[0])
                    if not isinstance(filename, str) or not os.path.isabs(filename):
                        raise ValueError('Wheel driver config_file must be absolute')
                    import yaml
                    with open(filename, encoding='utf-8') as source:
                        text = source.read(1024 * 1024 + 1)
                    if len(text) > 1024 * 1024:
                        raise ValueError('Wheel driver configuration is too large')
                    config = yaml.safe_load(text)
                    controller = config.get('wheel_controller', {}).get('type', '')
                    if not isinstance(controller, str) or not controller:
                        raise ValueError('Wheel controller type is unavailable')
                    self.respond(request, {'controller_type': controller, 'config_file': filename,
                                           'parameter': name + '::config_file'})
                except Exception:
                    self.error(request, ValueError('Cannot verify wheel controller type from the live config_file'))
            self.service(name + '/get_parameters', {'names': ['config_file']}, received,
                         lambda error: self.error(request, error))
            return
        if operation == 'get_param_names':
            self.list_parameters(request)
            return
        if operation in ('get_param', 'set_param'):
            self.parameter(request, operation)
            return
        if operation == 'topics':
            values = {'topics': [item[0] for item in topics], 'types': [graph_type(topics, item[0]) for item in topics]}
        elif operation == 'services':
            values = {'services': [item[0] for item in services]}
        elif operation == 'nodes':
            values = {'nodes': [namespace.rstrip('/') + '/' + name
                                for name, namespace in self.node.get_node_names_and_namespaces()]}
        elif operation == 'actions':
            actions = get_action_names_and_types(self.node)
            values = {'actions': [item[0] for item in actions], 'types': [graph_type(actions, item[0]) for item in actions]}
        elif operation == 'topic_type':
            values = {'type': graph_type(topics, args.get('topic', ''))}
        elif operation == 'service_type':
            values = {'type': graph_type(services, args.get('service', ''))}
        elif operation in ('publishers', 'subscribers', 'topic_info'):
            topic = args.get('topic', '')
            def endpoints(infos):
                return [{'node': info.node_namespace.rstrip('/') + '/' + info.node_name,
                         'reliability': int(info.qos_profile.reliability),
                         'durability': int(info.qos_profile.durability)} for info in infos]
            pub = endpoints(self.node.get_publishers_info_by_topic(topic))
            sub = endpoints(self.node.get_subscriptions_info_by_topic(topic))
            values = ({'publishers': [info['node'] for info in pub]} if operation == 'publishers'
                      else {'subscribers': [info['node'] for info in sub]} if operation == 'subscribers'
                      else {'type': graph_type(topics, topic), 'publishers': pub, 'subscribers': sub})
        elif operation == 'node_details':
            namespace, _, name = args.get('node', '').rpartition('/')
            namespace = namespace or '/'
            values = {
                'publishing': [n for n, _ in self.node.get_publisher_names_and_types_by_node(name, namespace)],
                'subscribing': [n for n, _ in self.node.get_subscriber_names_and_types_by_node(name, namespace)],
                'services': [n for n, _ in self.node.get_service_names_and_types_by_node(name, namespace)]}
        else:
            raise ValueError('Unsupported rosapi operation: ' + operation)
        self.respond(request, values)

    def action_event(self, goal_id, event, values):
        self.emit({'op': 'publish', 'topic': '/easyloop/action/' + goal_id + '/' + event, 'msg': values})

    def action(self, request):
        args = request.get('args') or {}
        goal_id = str(args.get('id') or '')
        if not goal_id or len(goal_id) > 128 or not all(c.isalnum() or c in '_-' for c in goal_id):
            raise ValueError('Invalid action request ID')
        if request['service'].endswith('/cancel_goal'):
            goal = self.goals.get(goal_id)
            if not goal:
                self.respond(request, {'cancelled': False, 'message': 'Goal is no longer active'})
                return
            goal['cancelled'] = True
            if goal.get('handle'):
                self.watch(goal['handle'].cancel_goal_async(),
                           lambda result: self.respond(request, {'cancelled': bool(result.goals_canceling),
                                                                 'return_code': result.return_code}),
                           lambda error: self.error(request, error))
            else:
                self.respond(request, {'cancelled': True, 'pending': True})
            return
        if not request['service'].endswith('/send_goal'):
            raise ValueError('Unsupported action operation')
        self.require_control()
        if goal_id in self.goals or len(self.goals) >= 8:
            raise ValueError('Action request duplicate or limit reached')
        name = str(args.get('action') or '')
        if self.scope != '/' and not name.startswith(self.scope + '/'):
            raise ValueError('Action is outside the selected robot namespace')
        type_name = graph_type(get_action_names_and_types(self.node), name)
        if not type_name or (args.get('type') and args['type'] != type_name):
            raise ValueError('ROS2 action unavailable or type mismatch: ' + name)
        key = (name, type_name)
        client = self.action_clients.get(key)
        if client is None:
            if len(self.action_clients) >= 32:
                raise ValueError('Action client limit reached')
            client = ActionClient(self.node, get_action(type_name), name)
            self.action_clients[key] = client
        if not client.wait_for_server(timeout_sec=0.2):
            raise ValueError('ROS2 action server is not ready: ' + name)
        message = get_action(type_name).Goal()
        set_message_fields(message, ros2_fields(args.get('goal') or {}))
        state = {'handle': None, 'cancelled': False, 'accept_deadline': time.monotonic() + 10, 'request': request}
        self.goals[goal_id] = state
        def failed(error):
            if state.get('handle'):
                state['handle'].cancel_goal_async()
            self.goals.pop(goal_id, None)
            self.error(request, error)
            self.action_event(goal_id, 'result', {'status': 6, 'message': str(error), 'result': {}})
        def accepted(handle):
            if not handle.accepted:
                failed(ValueError('ROS2 action goal rejected'))
                return
            state['handle'] = handle
            if not state.get('accept_timeout'):
                self.respond(request, {'accepted': True, 'id': goal_id})
            if state['cancelled']:
                handle.cancel_goal_async()
            def completed(result):
                self.goals.pop(goal_id, None)
                self.action_event(goal_id, 'result', {'status': result.status, 'result': message_to_ordereddict(result.result)})
            self.watch(handle.get_result_async(), completed,
                       lambda error: self.action_timeout(goal_id, error), timeout=1800)
        future = client.send_goal_async(message, feedback_callback=lambda result:
                                        self.action_event(goal_id, 'feedback', message_to_ordereddict(result.feedback)))
        # A late acceptance must still be tracked and cancelled, not forgotten.
        self.watch(future, accepted, failed, timeout=1800)

    def action_timeout(self, goal_id, error):
        state = self.goals.pop(goal_id, None)
        if state and state.get('handle'):
            state['handle'].cancel_goal_async()
        self.action_event(goal_id, 'result', {'status': 6, 'message': str(error), 'result': {}})

    def topic_type(self, request):
        topic = request.get('topic', '')
        task_scope = '/dt/ros/task/' + self.scope.strip('/') + '/'
        if not topic.startswith('/') or (self.scope != '/' and not topic.startswith(self.scope + '/')
                                         and not topic.startswith(task_scope)
                                         and topic not in ('/tf', '/tf_static', '/rosout', '/clock')):
            raise ValueError('Topic is outside the selected robot namespace')
        graph_name = graph_type(self.node.get_topic_names_and_types(), topic)
        requested = request.get('type') or self.advertised.get(topic) or ''
        if requested and '/msg/' not in requested:
            package, _, message = requested.partition('/')
            requested = package + '/msg/' + message
        if graph_name and requested and graph_name != requested:
            raise ValueError('ROS2 topic type mismatch: ' + topic)
        type_name = graph_name or requested
        if not type_name or '/msg/' not in type_name:
            raise ValueError('ROS2 topic type unavailable: ' + topic)
        return topic, type_name

    def handle(self, request):
        try:
            operation = request.get('op')
            if operation == 'call_service':
                service = request.get('service', '')
                if service.startswith('/rosapi/'):
                    self.rosapi(request)
                elif service.startswith('/easyloop/action/'):
                    self.action(request)
                else:
                    if self.scope != '/' and not service.startswith(self.scope + '/'):
                        raise ValueError('Service is outside the selected robot namespace')
                    if not service.endswith(('/get_parameters', '/list_parameters', '/describe_parameters',
                                              '/get_parameter_types', '/get_state', '/get_available_states',
                                              '/get_available_transitions', '/get_transition_graph',
                                              '/get_actions_info', '/actions/info', '/static_map')):
                        self.require_control()
                    requested = request.get('type') or ''
                    self.service(service, request.get('args') or {},
                                 lambda response: self.respond(request, message_to_ordereddict(response)),
                                 lambda error: self.error(request, error),
                                 requested if '/srv/' in requested else None)
            elif operation == 'subscribe':
                sub_id = request.get('id') or request.get('topic')
                if sub_id in self.subscriptions:
                    return
                if len(self.subscriptions) >= 96:
                    raise ValueError('ROS2 subscription limit reached')
                if request.get('topic', '').startswith('/easyloop/action/'):
                    self.subscriptions[sub_id] = None
                    return
                topic, type_name = self.topic_type(request)
                qos = subscription_qos(self.node.get_publishers_info_by_topic(topic),
                                       topic.endswith('/map') or topic.endswith('/tf_static'))
                throttle = max(0, int(request.get('throttle_rate') or 0)) / 1000
                last_sent = [0.0]
                def on_message(message):
                    now = time.monotonic()
                    if throttle and now - last_sent[0] < throttle:
                        return
                    last_sent[0] = now
                    data = message_to_ordereddict(message)
                    if type_name in ('sensor_msgs/msg/Image', 'sensor_msgs/msg/CompressedImage'):
                        data['data'] = base64.b64encode(bytes(message.data)).decode('ascii')
                    self.emit({'op': 'publish', 'topic': topic, 'msg': data})
                sub = self.node.create_subscription(get_message(type_name), topic, on_message, qos)
                self.subscriptions[sub_id] = (sub, request, qos, time.monotonic())
            elif operation == 'unsubscribe':
                sub_id = request.get('id') or request.get('topic')
                saved = self.subscriptions.pop(sub_id, None)
                if saved:
                    self.node.destroy_subscription(saved[0])
            elif operation == 'advertise':
                topic, type_name = self.topic_type(request)
                self.advertised[topic] = type_name
            elif operation == 'unadvertise':
                topic = request.get('topic', '')
                self.advertised.pop(topic, None)
                for key in list(self.publishers):
                    if key[0] == topic:
                        self.node.destroy_publisher(self.publishers.pop(key))
            elif operation == 'publish':
                self.require_control()
                topic, type_name = self.topic_type(request)
                if topic.endswith('/cmd_vel') or topic.endswith('/cmd_vel_selected'):
                    raise ValueError('Publish through cmd_vel_teleop to keep the safety gate in path')
                key = (topic, type_name)
                publisher = self.publishers.get(key)
                if publisher is None:
                    if len(self.publishers) >= 32:
                        raise ValueError('ROS2 publisher limit reached')
                    publisher = self.node.create_publisher(get_message(type_name), topic, 10)
                    self.publishers[key] = publisher
                message = get_message(type_name)()
                fields = ros2_fields(request.get('msg') or {})
                if type_name in ('sensor_msgs/msg/Image', 'sensor_msgs/msg/CompressedImage') and isinstance(fields.get('data'), str):
                    fields['data'] = list(base64.b64decode(fields['data']))
                set_message_fields(message, fields)
                publisher.publish(message)
            else:
                raise ValueError('Unsupported ROS2 bridge operation: ' + str(operation))
        except Exception as error:
            self.error(request, error)

    def poll(self):
        now = time.monotonic()
        for state in self.goals.values():
            if not state.get('handle') and not state.get('accept_timeout') and now >= state['accept_deadline']:
                state['accept_timeout'] = True
                state['cancelled'] = True
                self.error(state['request'], TimeoutError('ROS2 action acceptance timed out; late acceptance will be cancelled'))
        for saved in self.pending[:]:
            future, complete, fail, deadline, client = saved
            if future.done() or now >= deadline:
                self.pending.remove(saved)
                try:
                    if not future.done():
                        if client is not None:
                            client.remove_pending_request(future)
                        future.cancel()
                        raise TimeoutError('ROS2 request timed out')
                    complete(future.result())
                except Exception as error:
                    fail(error)
        for job in self.param_jobs[:]:
            if now >= job['deadline'] or (not job['nodes'] and not job['active']):
                names = sorted(set(job['names']))
                self.respond(job['request'], {'names': names, 'partial': bool(job['errors'] or job['active']),
                                               'errors': job['errors']})
                self.param_jobs.remove(job)
                continue
            while job['nodes'] and job['active'] < 6:
                node = job['nodes'].pop(0)
                job['active'] += 1
                def completed(response, job=job, node=node):
                    job['active'] -= 1
                    job['names'].extend(node + '::' + name for name in response.result.names
                                        if job['prefix'] in (node + '::' + name).lower())
                def failed(error, job=job):
                    job['active'] -= 1
                    job['errors'].append(str(error))
                try:
                    self.service(node + '/list_parameters', {'prefixes': [], 'depth': 0}, completed, failed, timeout=3)
                except Exception as error:
                    failed(error)
        # Publishers can change QoS during NAV/MAPPING transitions.
        for sub_id, saved in list(self.subscriptions.items()):
            if not saved or now - saved[3] < 2:
                continue
            sub, request, old_qos, _ = saved
            infos = self.node.get_publishers_info_by_topic(request['topic'])
            qos = subscription_qos(infos, request['topic'].endswith('/map') or request['topic'].endswith('/tf_static'))
            if infos and (qos.reliability != old_qos.reliability or qos.durability != old_qos.durability):
                self.node.destroy_subscription(sub)
                self.subscriptions.pop(sub_id, None)
                self.handle(request)
            elif sub_id in self.subscriptions:
                self.subscriptions[sub_id] = (sub, request, old_qos, now)

    def close(self):
        self.emit = lambda _value: None
        futures = []
        for state in list(self.goals.values()):
            if state.get('handle'):
                futures.append(state['handle'].cancel_goal_async())
            else:
                state['cancelled'] = True
        deadline = time.monotonic() + 1
        while time.monotonic() < deadline:
            pending_acceptance = any(not state.get('handle') for state in self.goals.values())
            if not pending_acceptance and (not futures or all(future.done() for future in futures)):
                break
            rclpy.spin_once(self.node, timeout_sec=0.02)
            self.poll()
        for client in self.action_clients.values():
            client.destroy()


def main():
    rclpy.init()
    node = rclpy.create_node('easyloop_bridge_{}'.format(os.getpid()))
    incoming = queue.Queue(maxsize=256)
    output_lock = threading.Lock()
    def emit(value):
        with output_lock:
            sys.stdout.write(json.dumps(json_safe(value), allow_nan=False, separators=(',', ':')) + '\n')
            sys.stdout.flush()
    bridge = Bridge(node, emit)
    def read_input():
        try:
            for line in sys.stdin:
                try:
                    request = json.loads(line)
                    if isinstance(request, dict):
                        incoming.put(request)
                except (ValueError, TypeError):
                    pass
        finally:
            incoming.put(None)
    threading.Thread(target=read_input, daemon=True).start()
    try:
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            if any(ns == bridge.scope for _, ns in node.get_node_names_and_namespaces()):
                break
            rclpy.spin_once(node, timeout_sec=0.05)
        emit({'op': 'status', 'level': 'info', 'msg': 'ROS2 bridge ready'})
        while rclpy.ok():
            # Bound each batch: continuous jog traffic must not starve ROS.
            for _ in range(16):
                try:
                    item = incoming.get_nowait()
                except queue.Empty:
                    break
                if item is None:
                    return
                bridge.handle(item)
            rclpy.spin_once(node, timeout_sec=0.01)
            bridge.poll()
    finally:
        bridge.close()
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
