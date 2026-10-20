"""Fixed read-only discovery: no ROS imports, shell startup or DDS graph queries."""
import json
import os
from pathlib import Path
import re
import socket

ROS1 = {'indigo', 'kinetic', 'lunar', 'melodic', 'noetic'}
ROS2 = {'ardent', 'bouncy', 'crystal', 'dashing', 'eloquent', 'foxy', 'galactic', 'humble', 'iron', 'jazzy', 'kilted', 'rolling'}
KEYS = {'ROS_VERSION', 'ROS_DISTRO', 'ROS_HOSTNAME', 'ROS_NAMESPACE', 'ROBOT_ID', 'RID', 'ROBOT_MODEL'}

def read(path):
    try:
        with open(path, 'rb') as stream:
            return stream.read(262144).decode(errors='replace')
    except OSError:
        return ''

def rid(value, numeric=False):
    match = re.fullmatch(r'/?R[_-]?(\d{1,3})/?', str(value), re.I)
    if not match and numeric:
        match = re.fullmatch(r'(\d{1,3})', str(value))
    return 'R_' + match.group(1).zfill(3) if match else None

def generation(env, argv=''):
    distro = env.get('ROS_DISTRO', '')
    if env.get('ROS_VERSION') == '2' or distro in ROS2 or re.search(r'/opt/ros/(?:' + '|'.join(ROS2) + r')/', argv):
        return 2
    if env.get('ROS_VERSION') == '1' or distro in ROS1 or re.search(r'/opt/ros/(?:' + '|'.join(ROS1) + r')/', argv):
        return 1
    return None

def inspect_robot():
    live = []
    for proc in Path('/proc').iterdir():
        if not proc.name.isdigit():
            continue
        argv = [arg for arg in read(proc / 'cmdline').split('\x00') if arg]
        if not argv or any('easyloop_discovery_probe' in arg for arg in argv):
            continue
        command = ' '.join(argv)
        # Only ROS runtime processes; never infer runtime from an arbitrary shell's inherited environment.
        ros2 = any(os.path.basename(arg) == 'ros2' and argv[i + 1:i + 2] == ['launch'] for i, arg in enumerate(argv))
        if not ros2 and not re.search(r'(?:/opt/ros/|/ros2_ws/(?:install|build)/|/(?:devel|install)/lib/|\b(?:rosmaster|roslaunch|rosout)\b)', command):
            continue
        env = dict(item.split('=', 1) for item in read(proc / 'environ').split('\x00') if '=' in item)
        major = 2 if ros2 else generation(env, command)
        if not major:
            continue
        current = {key: env[key] for key in KEYS if key in env}
        current['major'] = major
        current['bringup'] = any(os.path.basename(arg) == 'ros2' and argv[i + 1:i + 3] == ['launch', 'spx_bringup'] for i, arg in enumerate(argv))
        for arg in argv:
            if arg.startswith('ns:=') and rid(arg[4:]):
                current['RID'] = rid(arg[4:])
            if arg.startswith('robot_model:=') and re.fullmatch(r'[A-Za-z0-9_.-]+', arg[13:]):
                current['ROBOT_MODEL'] = arg[13:]
        live.append(current)
        if len(live) >= 256:
            break
    static = []
    for path in [Path.home() / 'scorpion.sh', Path.home() / '.bashrc', Path.home() / '.profile', Path('/etc/environment')]:
        env = {}
        for line in read(path).splitlines():
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            match = re.fullmatch(r'''(?:export\s+)?(ROS_VERSION|ROS_DISTRO|ROS_HOSTNAME|ROS_NAMESPACE|ROBOT_ID|RID|ROBOT_MODEL)\s*=\s*['"]?([A-Za-z0-9_.-]+)['"]?(?:\s*(?:#.*)?)''', line)
            if match:
                env[match.group(1)] = match.group(2)
            setup = re.match(r'''(?:source|\.)\s+['"]?/opt/ros/([a-z0-9_]+)/setup\.(?:bash|sh)(?:['"]?)(?:\s*(?:#.*)?)$''', line)
            if setup:
                env['ROS_DISTRO'] = setup.group(1)
        if env:
            env['major'] = generation(env)
            static.append(env)
    def values(records, keys):
        return sorted({str(item[key]) for item in records for key in keys if item.get(key)})
    roots = [item for item in live if item['bringup']]
    preferred = roots or live
    majors = {item['major'] for item in preferred or static if item.get('major')}
    major = next(iter(majors)) if len(majors) == 1 else None
    rid_values = {rid(item.get(key), key in ('RID', 'ROBOT_ID')) for item in preferred for key in ('RID', 'ROBOT_ID', 'ROS_HOSTNAME', 'ROS_NAMESPACE') if rid(item.get(key), key in ('RID', 'ROBOT_ID'))}
    if not rid_values:
        rid_values = {rid(item.get(key), key in ('RID', 'ROBOT_ID')) for item in static for key in ('RID', 'ROBOT_ID', 'ROS_HOSTNAME', 'ROS_NAMESPACE') if rid(item.get(key), key in ('RID', 'ROBOT_ID'))}
    if not rid_values and rid(socket.gethostname()):
        rid_values.add(rid(socket.gethostname()))
    models = values(preferred, ['ROBOT_MODEL']) or values(static, ['ROBOT_MODEL'])
    distros = values(preferred or static, ['ROS_DISTRO'])
    installed = sorted(path.name for path in Path('/opt/ros').iterdir() if path.is_dir()) if Path('/opt/ros').is_dir() else []
    return {'schemaVersion': 1, 'robotId': next(iter(rid_values)) if len(rid_values) == 1 else None,
            'rosMajor': major, 'distro': ' / '.join(distros), 'model': models[0] if len(models) == 1 else None,
            'installedDistros': installed, 'identityConflict': len(rid_values) > 1,
            'rosConflict': len(majors) > 1, 'bringupRunning': bool(roots),
            'evidence': 'bringup' if roots else 'process' if live else 'config' if static else 'installed' if installed else 'none',
            'robotEvidence': bool(major or installed or live), 'readOnly': True}

if __name__ == '__main__':
    print(json.dumps(inspect_robot(), ensure_ascii=False, separators=(',', ':')))
