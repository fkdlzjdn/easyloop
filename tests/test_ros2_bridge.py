"""Transport contract tests without importing a robot's ROS installation."""
import importlib.util
import math
import os
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import Mock, patch
from enum import IntEnum


class Reliability(IntEnum):
    RELIABLE = 1
    BEST_EFFORT = 2


class Durability(IntEnum):
    TRANSIENT_LOCAL = 1
    VOLATILE = 2


class QoS:
    def __init__(self, depth=10, reliability=Reliability.RELIABLE, durability=Durability.VOLATILE):
        self.depth, self.reliability, self.durability = depth, reliability, durability


class Message:
    def __init__(self):
        pass


def fields(message, values):
    for key, value in values.items():
        setattr(message, key, value)


def message_dict(message):
    return vars(message)


class FakeParameter:
    Type = IntEnum('Type', {'BOOL': 1, 'INTEGER': 2, 'DOUBLE': 3, 'STRING': 4, 'DOUBLE_ARRAY': 8})

    def __init__(self, name, type_, value):
        if type_ == 3 and not isinstance(value, float):
            raise ValueError('double required')
        self.name, self.kind, self.value = name, int(type_), value

    def to_parameter_msg(self):
        return types.SimpleNamespace(name=self.name, value={'type': self.kind, 'double_value': self.value})


class Future:
    def __init__(self, result=None, done=True):
        self.value, self.ready, self.cancelled = result, done, False

    def done(self):
        return self.ready

    def result(self):
        return self.value

    def cancel(self):
        self.cancelled = True


def module(name, **attributes):
    result = types.ModuleType(name)
    result.__dict__.update(attributes)
    sys.modules[name] = result
    return result


module('rclpy')
module('rclpy.action', ActionClient=Mock())
module('rclpy.action.graph', get_action_names_and_types=lambda node: node.actions)
module('rclpy.parameter', Parameter=FakeParameter, parameter_value_to_python=lambda value: value.value)
module('rclpy.qos', DurabilityPolicy=Durability, ReliabilityPolicy=Reliability, QoSProfile=QoS)
module('rosidl_runtime_py')
module('rosidl_runtime_py.convert', message_to_ordereddict=message_dict)
module('rosidl_runtime_py.set_message', set_message_fields=fields)
module('rosidl_runtime_py.utilities', get_action=lambda _: types.SimpleNamespace(Goal=Message),
       get_message=lambda _: Message, get_service=lambda _: types.SimpleNamespace(Request=Message))
spec = importlib.util.spec_from_file_location('easyloop_bridge', Path(__file__).parents[1] / 'server/ros2-ssh-bridge.py')
bridge_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge_module)


class BridgeTest(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {'EASYLOOP_ROBOT_ID': 'R_006', 'EASYLOOP_CONTROL_ENABLED': '1', 'EASYLOOP_LOCAL_PID': ''})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.events = []
        self.node = Mock()
        self.node.actions = []
        self.node.get_service_names_and_types.return_value = []
        self.node.get_topic_names_and_types.return_value = []
        self.node.get_publishers_info_by_topic.return_value = []
        self.node.get_subscriptions_info_by_topic.return_value = []
        self.node.get_node_names_and_namespaces.return_value = [('amcl', '/R_006')]
        self.bridge = bridge_module.Bridge(self.node, self.events.append)

    def request(self, service, args=None):
        return {'op': 'call_service', 'service': service, 'id': 'test', 'args': args or {}}

    def test_json_nan_and_arrays_are_serializable(self):
        import array
        result = bridge_module.json_safe({'nan': math.nan, 'inf': math.inf, 'values': array.array('i', [1, 2])})
        self.assertEqual(result, {'nan': None, 'inf': None, 'values': [1, 2]})

    def test_nested_legacy_headers_are_normalized(self):
        result = bridge_module.ros2_fields({'pose': {'header': {'seq': 42, 'stamp': {'secs': 3, 'nsecs': 4}, 'frame_id': 'map'}}})
        self.assertEqual(result['pose']['header'], {'stamp': {'sec': 3, 'nanosec': 4}, 'frame_id': 'map'})

    def test_qos_tracks_volatile_mapping_and_latched_navigation(self):
        endpoint = lambda r, d: types.SimpleNamespace(qos_profile=QoS(reliability=r, durability=d))
        mapping = bridge_module.subscription_qos([endpoint(Reliability.RELIABLE, Durability.VOLATILE)], True)
        self.assertEqual(mapping.durability, Durability.VOLATILE)
        nav = bridge_module.subscription_qos([endpoint(Reliability.RELIABLE, Durability.TRANSIENT_LOCAL)], True)
        self.assertEqual(nav.durability, Durability.TRANSIENT_LOCAL)
        mixed = bridge_module.subscription_qos([endpoint(Reliability.RELIABLE, Durability.TRANSIENT_LOCAL),
                                                 endpoint(Reliability.BEST_EFFORT, Durability.VOLATILE)], True)
        self.assertEqual((mixed.reliability, mixed.durability), (Reliability.BEST_EFFORT, Durability.VOLATILE))

    def test_service_type_mismatch_never_calls_a_service(self):
        self.node.get_service_names_and_types.return_value = [('/R_006/charge', ['std_srvs/srv/SetBool'])]
        request = self.request('/R_006/charge', {'data': True})
        request['type'] = 'std_srvs/srv/Empty'
        self.bridge.handle(request)
        self.node.create_client.assert_not_called()
        self.assertFalse(self.events[-1]['result'])

    def test_pending_service_timeout_removes_the_rclpy_request(self):
        future = Future(done=False)
        client = Mock()
        failed = Mock()
        self.bridge.watch(future, Mock(), failed, timeout=-1, client=client)
        self.bridge.poll()
        client.remove_pending_request.assert_called_once_with(future)
        self.assertTrue(future.cancelled)
        self.assertEqual(self.bridge.pending, [])
        self.assertIsInstance(failed.call_args.args[0], TimeoutError)

    def test_robot_scope_prevents_other_robot_mutations(self):
        self.bridge.handle(self.request('/R_001/charge', {'data': True}))
        self.node.create_client.assert_not_called()
        self.assertFalse(self.events[-1]['result'])
        self.bridge.handle({'op': 'publish', 'topic': '/R_001/cmd_vel_teleop', 'type': 'geometry_msgs/msg/Twist', 'msg': {}})
        self.node.create_publisher.assert_not_called()

    def test_final_velocity_output_cannot_bypass_safety_gate(self):
        for name in ('cmd_vel', 'cmd_vel_selected'):
            self.bridge.handle({'op': 'publish', 'topic': '/R_006/' + name, 'type': 'geometry_msgs/msg/Twist', 'msg': {}})
        self.node.create_publisher.assert_not_called()
        self.assertEqual(len(self.events), 2)

    def test_advertise_retains_the_type_for_roslib_publish_without_type(self):
        self.bridge.handle({'op': 'advertise', 'topic': '/R_006/cmd_vel_teleop', 'type': 'geometry_msgs/Twist'})
        self.bridge.handle({'op': 'publish', 'topic': '/R_006/cmd_vel_teleop', 'msg': {'linear': {'x': 0}}})
        self.node.create_publisher.assert_called_once()
        self.node.create_publisher.return_value.publish.assert_called_once()
        self.assertFalse(self.events)

    def test_ros2_parameter_get_is_explicit_and_typed(self):
        request = self.request('/rosapi/get_param', {'name': '/R_006/amcl::max_particles'})
        def call(name, args, success, _fail):
            self.assertEqual(name, '/R_006/amcl/get_parameters')
            self.assertEqual(args, {'names': ['max_particles']})
            success(types.SimpleNamespace(values=[types.SimpleNamespace(type=2, value=500)]))
        self.bridge.service = call
        self.bridge.handle(request)
        self.assertEqual(self.events[-1]['values'], {'value': '500', 'type': 2})

    def test_parameter_set_keeps_declared_double_type_and_surfaces_rejection(self):
        request = self.request('/rosapi/set_param', {'name': '/R_006/controller_server::max_speed', 'value': '1'})
        sent = []
        def call(name, args, success, _fail):
            sent.append((name, args))
            if name.endswith('/get_parameters'):
                success(types.SimpleNamespace(values=[types.SimpleNamespace(type=3, value=0.5)]))
            else:
                success(types.SimpleNamespace(results=[types.SimpleNamespace(successful=False, reason='read-only')]))
        self.bridge.service = call
        self.bridge.handle(request)
        self.assertEqual(sent[1][1]['parameters'][0]['value']['double_value'], 1.0)
        self.assertFalse(self.events[-1]['result'])
        self.assertIn('read-only', self.events[-1]['values']['message'])

    def test_parameter_names_preserve_the_node_and_report_partial_failure(self):
        self.node.get_service_names_and_types.return_value = [
            ('/R_006/amcl/list_parameters', ['rcl_interfaces/srv/ListParameters']),
            ('/R_001/amcl/list_parameters', ['rcl_interfaces/srv/ListParameters']),
            ('/R_006/controller_server/list_parameters', ['rcl_interfaces/srv/ListParameters'])]
        def call(name, _args, success, fail, **_kw):
            if 'controller' in name:
                fail(TimeoutError('offline'))
            else:
                success(types.SimpleNamespace(result=types.SimpleNamespace(names=['max_particles'])))
        self.bridge.service = call
        self.bridge.handle(self.request('/rosapi/get_param_names'))
        self.bridge.poll()
        self.bridge.poll()
        self.assertEqual(self.events[-1]['values']['names'], ['/R_006/amcl::max_particles'])
        self.assertTrue(self.events[-1]['values']['partial'])

    def test_compressed_image_is_base64_for_the_browser(self):
        self.bridge.handle({'op': 'subscribe', 'id': 'camera', 'topic': '/R_006/camera/compressed', 'type': 'sensor_msgs/msg/CompressedImage'})
        callback = self.node.create_subscription.call_args.args[2]
        callback(types.SimpleNamespace(format='jpeg', data=[1, 2, 3]))
        self.assertEqual(self.events[-1]['msg']['data'], 'AQID')

    def test_spx_task_status_namespace_is_allowed(self):
        self.bridge.handle({'op': 'subscribe', 'topic': '/dt/ros/task/R_006/status', 'type': 'std_msgs/msg/String'})
        self.node.create_subscription.assert_called_once()
        self.assertFalse(self.events)

    def test_virtual_action_subscription_does_not_create_a_ros_endpoint(self):
        self.bridge.handle({'op': 'subscribe', 'id': 'result', 'topic': '/easyloop/action/test/result'})
        self.node.create_subscription.assert_not_called()
        self.bridge.handle({'op': 'unsubscribe', 'id': 'result'})
        self.assertFalse(self.bridge.subscriptions)

    def test_qos_change_replaces_subscription_after_mode_transition(self):
        self.node.get_publishers_info_by_topic.return_value = [types.SimpleNamespace(qos_profile=QoS(durability=Durability.TRANSIENT_LOCAL))]
        self.bridge.handle({'op': 'subscribe', 'id': 'map', 'topic': '/R_006/map', 'type': 'nav_msgs/msg/OccupancyGrid'})
        saved = self.bridge.subscriptions['map']
        self.bridge.subscriptions['map'] = saved[:3] + (saved[3] - 3,)
        self.node.get_publishers_info_by_topic.return_value = [types.SimpleNamespace(qos_profile=QoS(durability=Durability.VOLATILE))]
        self.bridge.poll()
        self.node.destroy_subscription.assert_called_once()
        self.assertEqual(self.node.create_subscription.call_count, 2)

    def test_action_feedback_result_and_cancellation_are_connection_owned(self):
        self.node.actions = [('/R_006/follow_path', ['nav2_msgs/action/FollowPath'])]
        handle = Mock(accepted=True)
        handle.get_result_async.return_value = Future(types.SimpleNamespace(status=4, result=types.SimpleNamespace(error_code=0)))
        handle.cancel_goal_async.return_value = Future(types.SimpleNamespace(goals_canceling=['id'], return_code=0))
        client = Mock()
        client.send_goal_async.return_value = Future(handle)
        with patch.object(bridge_module, 'ActionClient', return_value=client):
            self.bridge.handle(self.request('/easyloop/action/send_goal', {'id': 'goal_1', 'action': '/R_006/follow_path', 'type': 'nav2_msgs/action/FollowPath', 'goal': {}}))
        self.bridge.poll()
        self.assertTrue(self.events[-1]['values']['accepted'])
        feedback = client.send_goal_async.call_args.kwargs['feedback_callback']
        feedback(types.SimpleNamespace(feedback=types.SimpleNamespace(distance_to_goal=1.0)))
        self.assertEqual(self.events[-1]['topic'], '/easyloop/action/goal_1/feedback')
        self.bridge.handle(self.request('/easyloop/action/cancel_goal', {'id': 'goal_1'}))
        self.bridge.poll()
        self.assertTrue(any(event.get('values', {}).get('cancelled') for event in self.events))
        self.assertTrue(any(event.get('msg', {}).get('status') == 4 for event in self.events))
        self.assertFalse(self.bridge.goals)

    def test_late_goal_acceptance_is_cancelled_after_response_timeout(self):
        self.node.actions = [('/R_006/follow_path', ['nav2_msgs/action/FollowPath'])]
        handle = Mock(accepted=True)
        handle.get_result_async.return_value = Future(done=False)
        client = Mock()
        future = Future(handle, done=False)
        client.send_goal_async.return_value = future
        with patch.object(bridge_module, 'ActionClient', return_value=client):
            self.bridge.handle(self.request('/easyloop/action/send_goal', {'id': 'late', 'action': '/R_006/follow_path', 'goal': {}}))
        self.bridge.goals['late']['accept_deadline'] = 0
        self.bridge.poll()
        self.assertFalse(self.events[-1]['result'])
        future.ready = True
        self.bridge.poll()
        handle.cancel_goal_async.assert_called_once()
        self.assertFalse(any(event.get('values', {}).get('accepted') for event in self.events))

    def test_readonly_connection_cannot_set_a_parameter_or_publish(self):
        with patch.dict(os.environ, {'EASYLOOP_CONTROL_ENABLED': '0'}):
            self.bridge.handle(self.request('/rosapi/set_param', {'name': '/R_006/amcl::max_particles', 'value': '500'}))
            self.assertFalse(self.events[-1]['result'])
            self.bridge.handle({'op': 'publish', 'topic': '/R_006/cmd_vel_teleop', 'type': 'geometry_msgs/msg/Twist', 'msg': {}})
        self.node.create_publisher.assert_not_called()
        self.node.create_client.assert_not_called()

    def test_parameter_cannot_target_another_robot(self):
        self.bridge.handle(self.request('/rosapi/set_param', {'name': '/R_001/amcl::max_particles', 'value': '500'}))
        self.node.create_client.assert_not_called()
        self.assertFalse(self.events[-1]['result'])

    def test_drive_model_comes_from_the_declared_config_file_not_a_model_name_hint(self):
        import tempfile
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml') as source:
            source.write('wheel_controller:\n  type: differential_drive\n')
            source.flush()
            def call(name, args, success, _fail):
                self.assertEqual(name, '/R_006/wheel_driver_node_exe/get_parameters')
                self.assertEqual(args, {'names': ['config_file']})
                success(types.SimpleNamespace(values=[types.SimpleNamespace(type=4, value=source.name)]))
            self.bridge.service = call
            self.bridge.handle(self.request('/rosapi/drive_model'))
        self.assertEqual(self.events[-1]['values']['controller_type'], 'differential_drive')
        self.assertEqual(self.events[-1]['values']['parameter'], '/R_006/wheel_driver_node_exe::config_file')

    def test_runtime_contract_reads_the_active_nodes_parameters(self):
        def call(name, args, success, _fail):
            self.assertEqual(name, '/R_006/vda_unified_runtime_node/get_parameters')
            self.assertEqual(args['names'], ['route_contract.schema', 'route_navigation.current_map_id', 'route_contract.frame_id', 'factsheet.maximum_speed'])
            success(types.SimpleNamespace(values=[types.SimpleNamespace(value=value) for value in ['spx.route_contract.v2', 'normal', 'map', 0.7]]))
        self.bridge.service = call
        self.bridge.handle(self.request('/rosapi/runtime_contract'))
        self.assertEqual(self.events[-1]['values'], {'schema': 'spx.route_contract.v2', 'mapId': 'normal', 'frameId': 'map', 'maximumSpeed': 0.7, 'robot': {'manufacturer': 'SysconRobotics', 'serial_number': 'R_006'}})
        self.node.create_publisher.assert_not_called()


if __name__ == '__main__':
    unittest.main()
