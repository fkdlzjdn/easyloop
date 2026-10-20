"""Read-only fast path: use the verified bringup's environment, never shell defaults."""
import json
import os
from pathlib import Path
import re
import subprocess

# EASYLOOP_ROS_VERSION fallback is handled by the server for shell-only/ROS1 hosts.
CONTEXT_KEYS = ['ROS_DOMAIN_ID', 'RMW_IMPLEMENTATION', 'CYCLONEDDS_URI',
                'ROS_AUTOMATIC_DISCOVERY_RANGE', 'ROS_LOCALHOST_ONLY', 'ROS_HOSTNAME']
RUNTIME_KEYS = CONTEXT_KEYS + [
    'PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ',
    'PYTHONPATH', 'PYTHONHOME', 'PYTHONNOUSERSITE', 'LD_LIBRARY_PATH',
    'AMENT_PREFIX_PATH', 'CMAKE_PREFIX_PATH', 'COLCON_PREFIX_PATH',
    'ROS_VERSION', 'ROS_DISTRO', 'ROS_STATIC_PEERS', 'ROS_DISCOVERY_SERVER',
    'FASTDDS_DEFAULT_PROFILES_FILE', 'FASTRTPS_DEFAULT_PROFILES_FILE',
    'RMW_FASTRTPS_USE_QOS_FROM_XML', 'ROS_SECURITY_ENABLE',
    'ROS_SECURITY_KEYSTORE', 'ROS_SECURITY_STRATEGY'
]


def probe():
    candidates = []
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            argv = [arg.decode() for arg in (entry / 'cmdline').read_bytes().split(b'\x00') if arg]
            if not any(os.path.basename(arg) == 'ros2' and argv[i + 1:i + 3] == ['launch', 'spx_bringup']
                       for i, arg in enumerate(argv)):
                continue
            live = dict(item.split('=', 1) for item in (entry / 'environ').read_bytes().decode().split('\x00') if '=' in item)
            robot = next((arg.split(':=', 1)[1] for arg in argv if arg.startswith('ns:=')), live.get('ROS_HOSTNAME', ''))
            if live.get('ROS_VERSION') != '2' or not re.fullmatch(r'R_\d{3,}', robot):
                continue
            if not re.fullmatch(r'[a-z0-9_-]+', live.get('ROS_DISTRO', '')):
                continue
            executable = os.readlink(str(entry / 'exe'))
            if not executable.startswith('/') or not os.access(executable, os.X_OK):
                continue
            env = {key: live[key] for key in RUNTIME_KEYS if key in live}
            candidates.append({'pid': entry.name, 'robotId': robot, 'distro': live['ROS_DISTRO'],
                               'environment': {key: live[key] for key in CONTEXT_KEYS if key in live},
                               'runtimeEnvironment': env, 'python': executable})
        except (OSError, ValueError, UnicodeError):
            continue
    if len(candidates) != 1:
        return None
    result = candidates[0]
    # Verify Python ROS imports without creating a ROS node or running shell setup.
    ready = subprocess.run([result['python'], '-B', '-c',
                            'import rclpy; from rclpy.action import ActionClient; '
                            'from rosidl_runtime_py.utilities import get_message'],
                           env=result['runtimeEnvironment'], capture_output=True, timeout=6)
    return result if ready.returncode == 0 else None


if __name__ == '__main__':
    try:
        print('EASYLOOP_FAST_RUNTIME=' + json.dumps(probe(), separators=(',', ':')))
    except (OSError, ValueError, subprocess.TimeoutExpired):
        print('EASYLOOP_FAST_RUNTIME=null')
