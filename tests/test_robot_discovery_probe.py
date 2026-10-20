import importlib.util
from pathlib import Path
from unittest import TestCase, main
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('probe', Path(__file__).parent.parent / 'server/robot-discovery-probe.py')
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)

class ReadOnlyDiscovery(TestCase):
    def snapshot(self, files=None, processes=None, installed=None):
        files = files or {}
        processes = processes or []
        installed = installed or []
        def entries(path):
            if str(path) == '/proc':
                return [Path('/proc') / str(pid) for pid in processes]
            if str(path) == '/opt/ros':
                return [Path('/opt/ros') / name for name in installed]
            return []
        with patch.object(probe, 'read', side_effect=lambda path: files.get(str(path), '')), patch.object(probe.Path, 'iterdir', entries), patch.object(probe.Path, 'is_dir', lambda path: str(path).startswith('/opt/ros') and bool(installed)), patch.object(probe.Path, 'home', return_value=Path('/home/robot')), patch.object(probe.socket, 'gethostname', return_value='syscon'):
            return probe.inspect_robot()

    def test_ros2_with_stopped_bringup_from_static_settings(self):
        result = self.snapshot({'/home/robot/.bashrc': 'source /opt/ros/jazzy/setup.bash\nexport ROBOT_MODEL=stl1000_ros2\nexport ROS_HOSTNAME=R_025\n'}, installed=['jazzy','noetic'])
        self.assertEqual(result['robotId'], 'R_025')
        self.assertEqual(result['rosMajor'], 2)
        self.assertEqual(result['model'], 'stl1000_ros2')
        self.assertFalse(result['bringupRunning'])
        self.assertEqual(result['evidence'], 'config')

    def test_running_local_bringup_overrides_stale_shell_settings(self):
        result = self.snapshot({'/proc/100/cmdline': '/opt/ros/jazzy/bin/ros2\x00launch\x00spx_bringup\x00bringup.launch.py\x00ns:=R_006\x00robot_model:=sl400_vri\x00', '/proc/100/environ': 'ROS_VERSION=2\x00ROS_DISTRO=jazzy\x00', '/home/robot/.bashrc': 'export ROS_DISTRO=noetic\nexport ROS_HOSTNAME=R_099'}, processes=[100], installed=['jazzy','noetic'])
        self.assertEqual(result['robotId'], 'R_006')
        self.assertEqual(result['rosMajor'], 2)
        self.assertEqual(result['model'], 'sl400_vri')
        self.assertTrue(result['bringupRunning'])

    def test_installed_distro_is_not_a_configured_ros_generation_or_guessed_rid(self):
        result = self.snapshot(installed=['jazzy'])
        self.assertTrue(result['robotEvidence'])
        self.assertIsNone(result['rosMajor'])
        self.assertIsNone(result['robotId'])

    def test_ignores_comments_and_does_not_execute_startup_text(self):
        result = self.snapshot({'/home/robot/.bashrc': '# export ROS_DISTRO=jazzy\nexport ROS_HOSTNAME=$(touch /tmp/must-not-execute)\nexport ROBOT_MODEL=`command`\n'})
        self.assertIsNone(result['robotId'])
        self.assertIsNone(result['model'])
        self.assertIsNone(result['rosMajor'])

    def test_conflicting_rid_and_generation_do_not_pick_an_arbitrary_robot(self):
        result = self.snapshot({'/home/robot/.bashrc': 'export ROS_DISTRO=jazzy\nexport RID=R_006\n', '/home/robot/scorpion.sh': 'export ROS_DISTRO=noetic\nexport RID=R_025\n'})
        self.assertTrue(result['identityConflict'])
        self.assertTrue(result['rosConflict'])
        self.assertIsNone(result['robotId'])
        self.assertIsNone(result['rosMajor'])

    def test_ros1_numeric_robot_id_and_ros2_namespace_are_supported(self):
        first = self.snapshot({'/home/robot/scorpion.sh': 'export ROS_DISTRO=noetic\nexport ROBOT_ID=1\n'})
        self.assertEqual(first['robotId'], 'R_001')
        self.assertEqual(first['rosMajor'], 1)
        second = self.snapshot({'/proc/100/cmdline': '/home/robot/ros2_ws/install/pkg/lib/pkg/node\x00', '/proc/100/environ': 'ROS_VERSION=2\x00ROS_NAMESPACE=/R_026\x00ROS_DISTRO=jazzy\x00'}, processes=[100])
        self.assertEqual(second['robotId'], 'R_026')

if __name__ == '__main__':
    main()
