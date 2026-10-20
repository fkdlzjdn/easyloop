import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('runtime_probe', Path(__file__).parents[1] / 'server/ros2-runtime-probe.py')
probe_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe_module)


class Process:
    name = '1234'

    def __truediv__(self, name):
        return SimpleNamespace(read_bytes=lambda: {
            'cmdline': b'/usr/bin/python3\x00/opt/ros/jazzy/bin/ros2\x00launch\x00spx_bringup\x00ns:=R_006\x00',
            'environ': b'ROS_VERSION=2\x00ROS_DISTRO=jazzy\x00ROS_DOMAIN_ID=6\x00PYTHONPATH=/workspace/install\x00PATH=/usr/bin\x00SECRET_TOKEN=do-not-copy\x00'
        }[name], __str__=lambda: '/proc/1234/exe')


class ProbeTest(unittest.TestCase):
    def inspect(self, processes=None, import_ok=True):
        self.run = Mock(return_value=SimpleNamespace(returncode=0 if import_ok else 1))
        with patch.object(probe_module.Path, 'iterdir', return_value=iter(processes if processes is not None else [Process()])), \
                patch.object(probe_module.os, 'readlink', return_value='/usr/bin/python3.12'), \
                patch.object(probe_module.os, 'access', return_value=True), \
                patch.object(probe_module.subprocess, 'run', self.run):
            return probe_module.probe()

    def test_uses_only_verified_runtime_paths_and_dds_environment(self):
        result = self.inspect()
        self.assertEqual(result['robotId'], 'R_006')
        self.assertEqual(result['environment']['ROS_DOMAIN_ID'], '6')
        self.assertNotIn('SECRET_TOKEN', result['runtimeEnvironment'])
        self.assertEqual(self.run.call_args.kwargs['env'], result['runtimeEnvironment'])
        self.assertIn('rclpy', self.run.call_args.args[0][-1])

    def test_missing_or_ambiguous_bringup_never_selects_a_fast_control_environment(self):
        self.assertIsNone(self.inspect([]))
        self.assertIsNone(self.inspect([Process(), Process()]))
        self.run.assert_not_called()

    def test_failed_python_import_preserves_the_legacy_fallback(self):
        self.assertIsNone(self.inspect(import_ok=False))


if __name__ == '__main__':
    unittest.main()
