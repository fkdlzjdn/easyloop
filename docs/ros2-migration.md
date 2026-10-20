# EasyLoop v1.5.1 — ROS1 / ROS2 사용 안내

ROS1 rosbridge 연결과 기존 기능을 유지하면서 Syscon SPX ROS2 Jazzy 환경을 추가했다. 기본 구현 브랜치는 `feat/ros2-migration`, 2026-10-20까지의 후속 개선 브랜치는 `feat/ros2-migration-improvements`다. R_006 / sl400_vri의 기존 수집 자료와 2026-10-12 R_025 / stl1000_ros2의 실제 소스·실행 계약을 대조했다. 액션·파라미터 검토는 [전체 기능 감사](ros2-full-migration-audit.md)를 참조한다.

## 2026-10-20 개선 스냅샷

이 절이 아래 단계별 검증 기록보다 최신이다. 엔지니어 미션 스케줄러, ROS1/ROS2 검색, BatteryState 표시, cfg 도킹 입력 검토, 로그인·연결 지연 개선, 알림 복사 아이콘을 포함한다. cfg를 통한 충전 진입 Task 입력과 충전 종료·이탈·대기 장소 복귀 전체 순환은 구분하며, 후자는 아직 완성된 자동 충전 흐름이 아니다.

ROS2 준비는 실행 중인 bringup의 허용된 환경 변수와 Python 실행 경로를 읽고 import를 확인해 반복 shell/workspace 로딩을 줄인다. namespace/domain/bringup 제어 범위 검증과 ROS1·shell fallback은 유지한다. R_006의 순차 읽기 전용 표본에서는 준비 API가 약 8.29초에서 1.52초, 로그인 응답 후 첫 배터리 표시가 약 14.16초에서 3.85초로 줄었다. 전체 대역 검색은 별도로 계속되며 이 수치가 모든 환경에서 보장되는 것은 아니다.

일반 Jog의 방향 버튼·키 해제는 500ms smoothstep 감속을 사용한다. 전용 Worker가 감속값을 계산하고 UI는 heartbeat를 갱신하며, Worker를 사용할 수 없으면 UI 계산을 사용한다. 반복 해제로 정지 시한을 연장하지 않고 완료 응답은 해당 해제 ID와 연결한다. STOP/S/Space, 안전 조건 상실, 연결·포커스 상실, 기존 350ms heartbeat 만료에는 즉시 정지 명령을 유지한다. 터치 드래그가 스크롤 취소로 바뀌지 않도록 처리했다. 이는 명령 속도 감속이며 실제 기구 제동거리 검증 결과가 아니다.

모델명 조회는 표시 정보만 갱신하며 검증된 Jog 어댑터를 초기화하지 않는다. AUTO Teleop은 실제 IO 정책과 안전 주행 경로를 확인한 경우에만 선택한다. IO 조회는 짧은 timeout과 1회 재시도를 사용한다. 구동 모드 미확인 상태는 차단하되 확인되지 않은 ManualJog 진단 토픽만으로 물리 MANUAL을 요구하거나 제한 Action 입력 폼을 표시하지 않는다. 별도 ManualJog의 활성화·정확한 Action·범위·준비 상태가 검증된 경우에는 해당 계약의 MANUAL 조건을 유지한다.

게이트의 `status`와 `allowed`는 서로 다른 DDS 토픽에서 도착한다. UI는 상태·사유가 한 메시지에 있는 `status`로 실제 차단을 구분하고 양쪽 진단 데이터의 타입·최신성을 확인한다. 정확히 `NORMAL/normal`, `STALE_SAFETY/startup_hold`, `STALE_SAFETY/command_timeout`만 정상/입력 대기로 취급한다. 비상정지·충돌·Task 정지·안전 데이터 만료·정지 미확인·알 수 없는 상태는 차단한다. 진단 구독을 throttle하지 않고 이전 구독 콜백을 폐기하며, 차단 팝업에는 실제 상태·사유를 표시한다. 로봇 측 게이트 설정과 최종 `cmd_vel` 출력 소유권은 그대로다.

`/tf_static`은 여러 발행자의 메시지를 누적해 센서 변환을 구성한다. 수신 제한으로 정적 변환을 누락하거나 카메라 메시지가 앞·뒤 LiDAR 변환을 지우지 않도록 수정했다. 같은 로봇 연결의 변환만 사용하며 ROS2에서 센서 변환이 미확인되면 임의로 로봇 중심에 점을 그리지 않는다. R_006의 맵 파일·ROS 토픽·새 브라우저의 occupancy 데이터는 동일한 해시였다. 별도 조회에서는 위치추정 품질이 `LOST`였고 로봇 TF로 직접 투영해도 맵 불일치가 재현됐다. 화면 좌표와 로봇 보고 좌표가 같다는 사실만으로 물리 위치추정이 정상이라고 판단하지 않는다. 위치 초기화나 로봇 설정 변경은 수행하지 않았다.

최종 소스 검증에서 Jest 737개/65 suites, Python 단위 테스트 31개, lint를 통과했다. 실제 R_006 연결 검증은 조회·구독만 사용하며 속도(0 포함)·Task·Action·취소·파라미터 쓰기는 차단했다. 늦은 모델명 응답, IO 조회 실패, 게이트 메시지 순서, UI 260ms 지연과 터치 해제를 모의 입력으로 검증했다. 이 스냅샷의 수정분으로 배포용 실행 파일을 다시 빌드한 결과는 포함하지 않는다.

## 실행

로컬 작업 경로는 `/home/syscon/repo/easyloop-ros2-r006`이다. 실제 worktree는 `/home/syscon/workspace/projects/easyloop-ros2-r006`에 있다. 원래 `/home/syscon/repo/easyloop`의 `develop` 및 미커밋 수정은 유지된다.

```bash
cd /home/syscon/repo/easyloop-ros2-r006
npm start
```

이 PC에서는 기존 `.env`를 복사해 같은 로그인 설정을 사용한다. 비밀번호와 환경 파일은 Git 및 실행 파일에 포함하지 않는다.

별도 PC에서 패키지를 사용할 때는 `.env.example`을 실행 파일 옆의 `.env`로 복사하고 `SHARED_PASSWORD`를 설정한다. Linux는 `./easyloop`, Windows는 `EasyLoop.exe`로 실행할 수 있다. `.env`의 `PORT` 또는 프로세스 환경변수로 포트를 지정한다. 기존 Windows 네트워크 설정 배치 파일은 선택적으로 사용한다.

## ROS1·ROS2 자동 검색

로그인 후 자동 검색과 기본 `로봇 스캔`은 ROS1/ROS2를 함께 찾습니다. 기본 대역은 기존 `192.168.20.0/24`이며 `192.168.3.5`도 확인합니다. ROS Bridge 포트(기본 9090), SSH 22·2222와 저장된 로봇별 SSH 포트를 확인합니다. 설정 화면에서는 ROS Bridge만 검색하거나 기존 SSH 포트포워딩 검색을 선택할 수도 있습니다.

ROS2에 rosbridge가 없거나 bringup이 내려가 있어도, SSH로 읽은 실행 프로세스·시작 설정에서 ROS 버전과 RID를 확인하면 검색 결과에 표시합니다. 시작 설정 파일은 텍스트로만 읽으며 source하지 않습니다. ROS CLI/graph 조회, bridge/bringup 시작, 설치·원격 파일 저장은 검색에서 하지 않습니다. 설치 폴더만 있는 경우에는 ROS 설정 완료로 간주하지 않습니다.

RID는 실제 관측값을 우선하며 IP 끝자리로 만들지 않습니다. ROS2로 확인된 결과를 선택하면 해당 RID·SSH 포트·ROS2 모드가 연결 슬롯에 적용됩니다. 검색된 로봇이 연결 준비를 마쳤다는 뜻은 아니며, 실제 연결에서는 기존 namespace/domain/bringup 제어 가능 검사를 유지합니다. 인증이나 RID 확인이 필요한 장비는 별도 표시하고 자동 연결에서 제외합니다.

서버의 기존 SSH 키로 먼저 조회합니다. 수동 등록 로봇의 계정/비밀번호가 있으면 해당 IP·포트에만 사용합니다. 비밀번호는 POST 본문으로 전달하고 URL·검색 응답에는 넣지 않습니다. TCP 확인은 최대 64개, SSH 식별은 최대 8개로 제한하며 중복 스캔은 동시에 실행하지 않습니다. 검색 자체는 읽기 전용입니다. 기존 자동 검색 이후 식별된 로봇의 연결 흐름은 유지합니다.

## 로봇 연결

1. 로봇 관리에서 IP, RID, SSH port를 등록한다. 현재 확인한 로봇은 **192.168.20.75 / R_025 / port 2222**다. IP 끝자리와 RID는 다르다. R_006 기준 IP는 `192.168.20.56`, RID는 `R_006`, SSH port는 `22`다.
2. ROS 모드를 선택한다. `ROS1`은 기존 rosbridge를 사용하며 ROS2 준비 요청을 하지 않는다. `ROS2`는 SSH를 통해 로봇의 ROS2 환경을 준비한다. `자동`은 shell 및 실행 중인 bringup의 환경을 조회해 버전을 결정한다.
3. ROS2는 SSH key 인증을 먼저 시도한다. 필요한 경우 등록된 비밀번호 또는 입력한 비밀번호로 연결한다.
4. 연결된 IPC의 실행 중인 `ros2 launch spx_bringup` namespace와 RID가 일치해야 한다. Domain은 실행 중인 bringup의 값을 사용한다. R_006의 과거 확인 값은 domain 6 / CycloneDDS다.
5. 로컬 bringup이 확인되지 않으면 ROS 제어는 차단하고 그래프 조회를 제공한다. bringup을 실행한 후 다시 연결해야 제어 준비 상태를 다시 검사한다. EasyLoop가 bringup을 자동 시작하지 않는다.

ROS2 브리지는 연결 시 로봇에서 임시 Python/rclpy 프로세스로 실행된다. 로봇에 패키지나 소스 파일을 설치하지 않는다. 서버 PC에는 ROS2 설치가 필요하지 않으며, 로봇에는 Jazzy 및 workspace의 Python 메시지·서비스·액션 인터페이스가 있어야 한다. 연결 해제 시 해당 연결이 만든 구독·발행·액션 클라이언트를 정리한다.

## 기능

| 기능 | ROS1 | ROS2 |
|---|---|---|
| 접속 | 기존 rosbridge / SSH tunnel | SSH/rclpy bridge, 실제 domain·namespace 확인 |
| node/topic/service 조회 | 기존 rosapi / ROS1 CLI | ROS2 graph 및 ROS2 CLI |
| 지도·pose·scan·camera | 기존 구독 | ROS2 타입·timestamp·이미지·QoS 처리 |
| 배터리·로봇 상태 | 기존 BMS / RobotState | BatteryState / SPX RobotState |
| Params | 기존 ROS1 파라미터 | 노드별 조회·편집, 선언 타입 및 변경 거부 결과 처리 |
| 조그 | 기존 검증된 cmd_vel | teleop → mux → safety gate → wheel driver 연결 확인 |
| SLAM / LIFELONG / NAV | 기존 모드 인터페이스 | 실제 SPX SetMode 서비스 확인 후 사용 |
| 지도 저장·로드 | 기존 계약 유지 | SPX SaveMap, Nav2 LoadMap, 실제 pose graph 타입 |
| 초기 위치 지정 | 기존 header/time | ROS2 header/time |
| 목적지 지정 | 기존 ROS1 goal | 실제 NavigateToPose 서버가 있을 때만 실행·취소 |
| Task / Quick Task | 기존 검증된 scheduler | 등록 catalog 기반, RouteNavigation(48) 편집·변환, StandBy(7) |
| 리프트 | 기존 계약 유지 | 실제 LiftCmd 타입, AUTO/IDLE/STO 검사, 높이 mm |
| 반복 도킹 시험 | 기존 ROS1 시험 노드 | ROS1 전용 시험 차단, RouteNavigation 도킹 연결 사용 |
| rosbag | ROS1 bag | ROS2 bag directory / db3 / mcap, 기록·재생·정보 조회 |
| scorpion 재시작·카메라 자동 수정 | 기존 동작 | ROS1 전용 명령을 실행하지 않음 |
| 로봇 비교 | 각 로봇의 실제 파라미터 | 노드별 파라미터 조회 및 해당 IPC 정보 |
| 설정 일괄 복사 | 기존 ROS1 범위 | ROS1 값의 의미를 임의로 변환하지 않으며 Params에서 개별 편집 |

지원 여부는 로봇의 실제 graph와 타입에 따라 판정한다. 예를 들어 relay service 응답은 충전 도킹 완료나 실제 충전 전류를 보증하지 않는다. 자동 charge relay 출력과 BMS 충전 전류를 별도로 표시한다.

## Params

ROS2 식별자는 `/node::parameter` 형식이다.

```text
/R_006/amcl::max_particles
/R_006/controller_server::FollowPath.desired_linear_vel
/R_006/wheel_driver_node_exe::config_file
```

Params에서 노드 이름 또는 파라미터 이름으로 검색하고 값을 변경한다. 노드가 변경을 거부하면 성공으로 표시하지 않는다. 배열은 JSON 배열로 입력한다. 타입은 현재 노드에 선언된 타입을 유지한다. 파라미터 목록은 응답하지 않는 노드가 있을 때 부분 결과를 표시할 수 있다.

ROS2 차상 모델은 wheel driver의 실제 `config_file` 파라미터와 해당 YAML의 `wheel_controller.type`을 먼저 확인한다. 모델 이름이나 Git 프로젝트 이름만으로 action payload의 모델을 선택하지 않는다.

## 작업 탭의 ROS2 폼

활성 로봇의 ROS2 transport를 인식하면 작업 탭에 `ROS2 · SPX Task`와 실제 등록된 Action 목록을 표시한다. graph 확인 중에도 ROS2 입력 양식을 표시하되, 등록 여부가 확인되기 전에는 실행을 허용하지 않는다. 다른 로봇의 discovery 응답이나 반복 갱신은 현재 작성 중인 입력을 초기화하지 않는다.

R_025에서는 RouteNavigation(48), StandBy(7)가 표시된다. RouteNavigation의 Action Params에는 `route_contract_json(string)`과 선택 `maximum_speed_mps(float)`를 표시한다. StandBy는 정수 timeout과 `id(string)`를 사용하며 ROS1 Common Params를 섞지 않는다. ROS1/ROS2의 마지막 입력 저장도 분리한다.

Task 형식 확인 패널에서 `task_id → missions → actions`, `action_type`, `action_args`, `action_params`의 ROS2 요청 모양을 로컬에서 확인할 수 있다. 실제 로봇으로 전송하는 기능이 아니다. 기본 Task는 ROS 버전에 맞춰 보여주며, 기존 사용자 Task는 보존하고 ROS2 변환이 필요하면 실행 버튼에 이유를 표시한다. RouteNavigation 기본 양식에는 목표 좌표를 임의로 넣지 않는다.

ROS1 로봇으로 전환하면 기존 Action 목록·파라미터·기본 Task가 복원된다. 등록되었지만 아직 입력 schema를 검증하지 못한 ROS2 Action은 이름을 표시하고 입력 정의 미확인으로 구분한다.

## R_025 경로 입력

Task에서 `RouteNavigation (0x30)`을 선택한다. 목적지 계획은 기존 WayPoint 용도이며 목적지 좌표를 입력하면 runtime이 현재 위치부터 계획한다. 지정 경로는 기존 TrajectoryFollowing 용도이며 시작점부터 종료점까지 두 개 이상의 경로점을 입력한다. NURBS는 제어점을 입력한다. 지도 선택/현재 위치 추가, 경로 폭, 장애물 정책, 전진/후진, 최대 선속도를 지원한다.

지도 ID는 현재 runtime의 `normal`, frame은 `map`, schema는 `spx.route_contract.v2`다. `maximum_speed_mps`는 로봇의 `factsheet.maximum_speed` 이하로 입력한다. Task 전송 전에 실제 task/action 식별자로 계약을 다시 연결한다. 현재 로봇은 Mission 하나와 `loop_flag: 1`만 지원한다.

기존 Task를 가져온 뒤 **ROS2 경로 변환 검토**를 누르면 WayPoint/TrajectoryFollowing을 변환한다. `max_trans_vel`과 주행 방향은 대응하며, 허용 오차 등 나머지 파라미터는 검토에 표시한다. 원본 queue는 브라우저 localStorage에 별도 백업한다. 현재 등록되지 않은 독립 Action은 자동 변환하거나 전송하지 않는다.

도킹 연결은 기존 4개 인자를 재사용하지 않고 새 `[is_charge,direction,scan_type]` 3개 인자를 입력한다. 목표 선택·도킹 파라미터·전환 정책은 상세 JSON의 실제 계약을 사용한다. 혼합 경로/가중 NURBS는 상세 JSON을 유지해 편집한다.

### R_006 cfg 충전 연결 확인 (2026-10-20)

R_006의 현재 bringup은 Jazzy / `sl400_vri` / Domain 6이다. 읽기 전용 조회에서 `battery_state`의 percentage 약 0.87과 `/bms`의 SOC 87을 수신했고, 별도 Chromium의 실제 SSH/rclpy 연결에서도 상단 배터리 87%를 확인했다. 기존 화면의 미표시 현상은 이 연결에서는 재현되지 않았다. 재연결 후에도 안 보이면 해당 브라우저의 구독/graph 상태를 추가 확인해야 한다. 미수신·null·NaN·문자열 SOC는 유효한 0%로 변환하지 않으며 `--%`로 표시한다. ROS2 CHARGING 상태는 전류값이 작더라도 표시까지 유지한다.

cfg 파일은 충전소 좌표가 아니라 도킹 대상 인식에 사용하는 리소스다. 현재 로봇에는 `ros_parameters_group/param/sl400_vri/docking/cfg/docking_vri_charger.cfg`와 `docking_wdc_charger.cfg`가 있다. 파일이 있다는 사실만으로 해당 현장 충전기에 맞는 설정이라고 보장하지 않는다. 연결 순서는 다음과 같다.

1. 작업 탭에서 `RouteNavigation(48)`을 선택하고 실제 충전소 접근 위치와 경로를 작성한다. 지도는 현재 runtime의 `normal`, frame은 `map`이다. 위치·방향·접근 거리/오프셋은 실제 충전소 기준으로 정한다.
2. 도킹 연결을 켜고 충전 도킹을 선택한다. 현재 ROS2 인식 방식은 `1=LiDAR cfg/Rack`, `2=ArUco`, `3=Direct pose`다. cfg를 사용할 때는 1을 선택한다. ROS1의 `2=LV`, `4=Rack`, `5=ArUco` 숫자를 그대로 넣지 않는다. 가져온 이전 값은 자동 변환하지 않고 재선택하도록 표시한다.
3. 상세 경로 JSON의 기존 내용을 유지하면서 `docking_parameters`에 `"rack.cfg": "cfg/docking_vri_charger.cfg"`처럼 로봇 리소스 기준 상대 경로를 지정한다. 이 파일명은 기존 파일로 설명한 예이며 충전소 선택을 확정한 것이 아니다. 절대 경로나 `..` 경로는 로봇 계약에서 허용하지 않는다. 기존 `docking_target_selection`의 PROFILE과 다른 cfg를 동시에 선택하면 충돌하므로 새 cfg 선택에는 이전 PROFILE을 혼합하지 않는다.
4. Task를 저장한 뒤 엔지니어 미션 스케줄러에서 대상 로봇과 해당 Task를 지정하고 배터리 조건을 `이하 30%`로 설정한다. 형식 확인은 명령을 전송하지 않는다. 실제 자동 실행은 AUTO와 예약 시작을 명시적으로 선택한 경우에만 동작하며, 이 확인 작업에서는 예약을 만들거나 활성화하지 않았다.

이 구성은 cfg를 담은 충전 진입 Task 입력까지다. 전체 `30% 이하 → 충전 진입 → 충전 확인 → 80% 이상 → 충전 종료 확인 → 도킹아웃 → 대기 장소 복귀`를 즉시 지원한다는 뜻은 아니다. 현재 R_006의 ActionInfo에는 RouteNavigation(48)과 StandBy(7)만 등록돼 있으며 독립 DockingOut(16)은 없다. EasyLoop 스케줄러의 충전 중 실행 예외는 실제 DockingOut(16) 시작 Task뿐이므로 RouteNavigation을 이름만 바꿔 이 예외를 통과시킬 수 없다. ROS2 runtime의 충전 종료/이탈 계약과 소유권·실제 충전 상태·이전 단계 완료를 연결하는 구현 및 비이동 검증이 추가로 필요하다. 80% 이상 미션 하나를 별도로 만드는 것만으로 이 순환이 완성되지 않는다. 예약은 브라우저에서 실행되므로 탭 종료 중에는 동작하지 않는다.

근거는 해당 IPC의 `core_task/plugins/actions/spx_route_navigation_plugin/src/docking_input_adapter.cpp:104`, `core/spx_route_contract/include/spx_route_contract/docking_parameters.hpp:29`, `core_navigation/spx_navigation_goal_refiner/src/goal_refiner_node.cpp:809`와 실제 ActionInfo/BMS 조회다. 로봇 cfg·파라미터·서비스는 변경하지 않았고 Task/주행/충전/취소 명령도 보내지 않았다.

### R_006 Jog 차단 원인 (2026-10-20)

실제 `/R_006/io/state_monitor/mode`는 `true`(물리 AUTO), `/robot_state.workstate`는 0(IDLE), `/io/state_monitor/sto`와 `/emo`는 false, `/cmd_safety_gate/allowed`는 true였다. 최초에는 별도 ManualJog Action의 MANUAL 조건을 일반 Jog에도 적용했으나, 이는 이 모델의 모터 모드 의미를 잘못 해석한 것이었다. 후속 실설정 조회에서 sl400_vri는 MANUAL이 모터 해제이고 AUTO가 구동 허용임을 확인해 아래 일반 Teleop 경로로 정정했다. 화면 상단 MANUAL/AUTO는 EasyLoop 예약 실행 모드이며 로봇의 물리 모드를 바꾸지 않는다.

`/R_006/cmd_safety_gate::manual_jog.enabled=false`이고 별도 제한거리 Action의 상한은 0이며 `/R_006/manual_jog/execute` Action은 graph에 없다. 이 플래그는 제한거리 ManualJog Action의 활성화 설정이며, 정상적인 AUTO 구동 모드의 `cmd_vel_teleop` 입력을 비활성화하는 플래그가 아니다. 두 기능을 혼동해 일반 Jog까지 차단하던 앱 경로 선택을 수정했다. 별도 Action 클라이언트는 유지하지만 로봇의 해당 플래그나 제한 설정은 변경하지 않았다.

로봇 `cmd_safety_gate_node.cpp:247`은 물리 MANUAL(`mode=false`), brake locked(`brake=false`), 신선한 안전/충전/odom 상태를 요구한다. 이전 EasyLoop의 ROS1 BRAKE RELEASE 기준을 최신 ROS2 ManualJog에 적용하지 않도록 구분했다. ROS1 판정은 유지한다. Jog 패널을 graph 조회 완료 전에 열었을 때 안전 토픽 구독이 비어 있던 문제도 profile 갱신 시 재구독하도록 보완했다. 원인 확인과 회귀 검증에서 속도·Action 목표·취소를 보내지 않았다.

### LiDAR 화면 수신 최적화 (2026-10-20)

통합 `/scan`과 전·후방 `/scan_1`, `/scan_2`를 동일한 라이다 전용 구독 WebSocket으로 이동한다. 지도·카메라·서비스 응답과 브리지 프로세스를 분리하며 기존 ROS1 proxy/ROS2 SSH session을 재사용한다. 라이다가 켜진 활성 로봇만 연결하고 마지막 라이다 레이어를 끄거나 로봇을 전환/연결 해제하면 닫는다. 전용 연결 실패 시 기본 연결로 수신을 되돌리고 활성 로봇에서만 재연결한다.

이전 제한은 통합 50ms, 전·후방 150ms였다. 세 소스를 25ms 구독 요청과 `queue_length=1`로 통일했다. R_006 원본 발행은 약 30Hz이며 실제 간격이 33ms보다 짧아 33ms 제한에서는 매 두 번째 프레임이 빠질 수 있어 25ms를 사용한다. 화면은 기존 requestAnimationFrame 병합을 유지하며 오래된 구독/로봇 연결의 콜백과 중복·역순 timestamp를 폐기한다. ROS clock 재설정은 1초 정체 후 새 기준으로 복구한다. ROS2 브리지의 DDS history 자체를 변경한 것은 아니다.

물리 입력을 차단한 Chromium 실제 연결에서 세 레이어 동시 수신을 순차 측정했다. 통합은 12.5→15.4Hz, 전방은 5.9→15.4Hz, 후방은 5.7→15.4Hz였다. 수신 간격 p95는 통합 215.9→102.6ms, 전방 320.3→120.7ms, 후방 298.4→99.2ms였다. 이는 해당 표본의 수신 간격이며 clock 동기화를 전제로 한 편도 지연값이나 모든 환경의 성능 보장이 아니다. 원본 약 30Hz의 전 프레임을 전달하는 수준은 아직 아니다. 실제 BMS·지도·pose·Jog 차단 사유도 함께 수신했고 브라우저 JS 오류와 제어 명령 전송은 없었다. Jest 646개/61 suites, lint, diff check를 통과했다. 프론트엔드 변경이므로 현재 서버를 재시작하지 않았으며 브라우저 새로고침과 로봇 재연결로 적용한다.

### 로그인 후 첫 통신 지연 최적화 (2026-10-20)

기존에는 로그인 후 전체 /24 검색의 SSH 메타데이터 조회가 모두 끝나야 이전 로봇에도 연결했다. 최근 로봇의 IP/RID·SSH/WS 포트·ROS 선택·터널 설정을 접속 힌트로 저장하고 로그인 직후 우선 연결하며 전체 검색은 병행한다. 비밀번호나 검증 완료 capability는 이 힌트에 저장하지 않는다. 검색 완료 시 이미 진행 중인 연결을 삭제·재시작하지 않는다. 동시에 발생한 같은 연결 요청은 하나의 prepare를 공유하되, 모드/접속 설정/연결 generation이 달라지면 새 요청으로 구분한다. Test Mode에서는 실제 로봇 우선 연결을 하지 않는다. 저장 정보가 없거나 해당 로봇이 꺼져 있으면 전체 검색 경로가 필요하다.

`/rosapi/topics`에 현재 topic/type 목록이 함께 있으면 같은 타입을 개별 RPC로 다시 묻지 않는다. 타입 목록이 없는 서버는 기존 개별 조회를 유지한다. 검증한 topic/type으로 배터리·RobotState 수신을 먼저 시작하지만, 이는 별도의 읽기 전용 monitoring snapshot이며 Task·Jog·모드·기타 제어 capability로 사용하지 않는다. 제어 graph/Action catalog/주행 safety chain 검증은 끝까지 수행한다. 다른 ROS 연결이나 이전 discovery token에서 도착한 응답은 폐기한다.

배터리·RobotState·Jog 안전 토픽은 준비된 pose/telemetry 연결을 이용해 지도·카메라·전체 파라미터 조회와 경쟁하지 않도록 한다. 보조 연결이 끊기면 기본 연결로 되돌리고 다시 연결될 때 재구독한다. 노드·파라미터 전체 조회는 ROS 정보 탭을 열었을 때 수행한다. 사용자 버튼에 의한 조회·기능은 유지한다.

실제 R_006에서 로그인 API 응답 뒤 첫 배터리 UI 표시까지 27.51초→13.78초, WebSocket 연결까지 19.97초→7.92초로 측정했다. 로그인 인증 자체는 약 12~13ms였고 남은 지연에는 기존 서버의 ROS2 환경 준비 약 8초와 브리지 시작이 포함된다. 두 번의 순차 표본이며 저장된 최근 R_006 재연결 기준이다. 별도 읽기 전용 브라우저 검증에서 숨겨진 파라미터 조회 0회, ROS 정보 탭 진입 시 조회 시작, telemetry 연결을 통한 BMS/Jog 상태 수신, JS 오류 및 제어 명령 전송 0건을 확인했다. 실제 수신 후 Jog 사유는 `manual_jog.enabled=false`와 물리 AUTO였으며 MANUAL·IDLE·STO·Brake 미수신 문구는 없었다. 안전 조건과 로봇 설정을 변경한 결과가 아니다. Jest 654개/61 suites, lint, diff check를 통과했다. 현재 서버 재시작은 하지 않았으며 브라우저 새로고침 후 적용된다.

### ROS2 제한 Jog Action 클라이언트 (2026-10-20 후속)

별도 제한거리 Action을 사용하는 어댑터는 `/RID/manual_jog/execute`의 `spx_task_msgs/action/ManualJog`를 사용한다. 로봇에서 enabled=true, 모든 허용 범위·정지 판정값, 정확한 Action type을 읽어 검증한 경우에만 입력을 받는다. 이 Action의 물리 MANUAL·IDLE·STO·EMO·브레이크 잠금·충전 해제·Jog 준비 상태 조건은 유지한다. 아래 AUTO=모터 구동 모델의 일반 Teleop와 구분한다. ROS1은 기존 cmd_vel/Worker를 유지하고 ROS2에서 돌아오면 원래 속도 슬라이더 범위를 복원한다.

ROS2에서는 이동거리(m) 또는 회전각도(도)를 사용자가 직접 입력하고 전후 이동 또는 회전을 한 축씩 요청한다. 입력값은 로봇의 상한 이하여야 하며 목표의 각도는 라디안으로 변환한다. 버튼 1회에 하나의 유한 Action만 실행하고 자동 반복하지 않는다. 동일한 command_id를 `/RID/manual_jog/lease`에 50ms마다 보낸다. 손을 떼거나 STOP·안전 조건 상실·페이지 숨김·실행시간 만료 시 lease를 멈추고 이 연결이 만든 해당 Action만 취소한다. 로봇의 독립적인 250ms lease 만료도 그대로 적용된다. 취소 승인이나 0 속도를 물리 정지로 판단하지 않는다. 성공·취소·실패의 실제 ROS2 terminal result와 stop_confirmed=true를 확인해야 실행 추적을 해제하며, 결과 유실/정지 미확인은 재실행을 차단한다.

실제 R_006 재조회에서도 enabled=false, 주요 상한·정지 판정값 0, 물리 AUTO, 전용 Action 미제공을 확인했다. 사용자는 직접 로봇을 움직이지 말라고 지시했다. 로봇의 설정·모드·프로세스는 변경하지 않았다. 별도 제한거리 Action을 활성화하려면 유효한 제한 설정과 로봇 시작 과정이 필요하며 enabled 파라미터 하나를 바꾸는 것만으로 서버가 생성되지 않는다. 일반 Teleop의 모드 선택은 다음 후속 수정에서 정정했다.

검증은 모의 ROSLIB 서비스/토픽 및 물리 WebSocket 차단 상태에서 수행했다. 전후 이동 목표, 도→라디안 변환, 버튼 해제 취소, lease 중단, 실제 정지 결과 대기, AUTO/비활성 설정 차단, 정지 결과 미확인 시 재실행 차단을 확인했다. 가상의 시험 상한은 실제 로봇에 적용하지 않았다. 오른쪽 아래 알림의 복사 버튼은 작은 SVG 아이콘으로 변경했고, 완료/실패도 아이콘으로 표시한다. 설명은 title/aria-label에 유지하며 HTTP IP 접속에서 전체 문구 복사를 검증했다.

### sl400_vri 일반 Jog의 AUTO 모터 구동 조건 정정 (2026-10-20)

사용자가 설명한 모델 의미를 실제 실행 중인 `/R_006/io_driver_node::config_path`에서 확인했다. 해당 설치 파일의 `local_release.mode_topic=io/state_monitor/mode`, `brake_switch_topic=""`는 모드 신호만으로 MANUAL 모터 해제를 요청하는 설정이다. IO 소스에도 `MANUAL requests release`가 명시돼 있으며 휠 드라이버는 local_release 활성 상태의 cmd_vel을 거부한다. 따라서 이 모델의 일반 조작은 AUTO에서 모터 구동을 허용받아야 한다. 앞선 일괄 MANUAL 요구 판정과 설명은 오류였다.

앱은 모델명이나 저장 힌트로 이 조건을 추정하지 않는다. 현재 ROS2 연결에서 IO 노드의 config_path를 읽고 해당 파일의 비밀정보 없는 local_release 항목만 조회해 모드 의미를 검증한다. 검증된 mode-only 모터 해제 모델이며 `cmd_vel_teleop → cmd_vel_mux → cmd_safety_gate → wheel_driver`의 실제 graph/type 경로가 맞을 때 일반 Teleop 어댑터를 선택한다. 다른 모드 정책·접속 변경·조회 실패를 이 조건으로 덮어쓰지 않는다. 별도 ManualJog Action은 원래 조건과 비활성 상태를 유지한다.

일반 Jog는 AUTO 구동 허용, IDLE, STO/EMO/라이다/범퍼 정상, 모터 해제 비활성, IO 장치 정상, 충전 해제, 최신 안전 게이트 상태를 요구한다. 진행 중이거나 종료 확인 중인 Task/Scheduler 작업도 차단한다. 입력이 없어서 0을 출력하는 watchdog의 startup_hold/command_timeout만 모든 물리 IO 조건을 만족할 때 새 입력을 대기할 수 있으며, stale_safety·collision_hold·task_stop·물리 정지 미확인은 차단한다. 일반 조작은 기존 Worker/20Hz hold-to-run 경로를 사용하고 `cmd_vel`에 직접 쓰지 않는다. 사용자가 Jog 입력을 시작하면 미래 Scheduler 예약은 중지한다. 모터·ROS2 노드·안전 게이트의 설정이나 조건은 변경하지 않았다.

실제 R_006에서 AUTO, IDLE, STO/EMO/LCCS 해제, 모터 해제 비활성, IO 정상, 충전 해제, `state=NORMAL reason=normal`을 읽어 앱의 READY 판정을 확인했다. 이 확인에서는 속도·Action·취소·파라미터 쓰기를 모두 차단했고 실제 이동 명령은 0건이다. 별도 모의 브라우저에서는 정상 AUTO 입력의 cmd_vel_teleop 전송, 버튼 해제 시 0 및 발행 중지, MANUAL/안전 조건 이상 차단을 검증했다. Jest 692개/63 suites와 lint를 통과했다. 실제 주행은 실행하지 않았으며 브라우저 새로고침과 로봇 재연결로 수정된 어댑터가 적용된다.

## R_006의 과거 작업 및 주행 제한

9/30 수집 action은 ComputePathToPose, ComputePathThroughPoses, FollowPath이며 NavigateToPose는 없었다. 따라서 일반 목적지 지정 버튼으로 임의의 ROS1 goal을 발행하거나 planner/controller를 직접 묶어 VDA 자원 소유권을 우회하지 않는다. ROS2 Actions 버튼에서 제공되는 action과 Task 입력 상태를 조회할 수 있다.

9/29 스냅샷에서는 VDA Task 입력이 비활성이었다. 이 경우 Task/자동 도킹/충전 도킹은 EasyLoop 코드 이관만으로 활성화되지 않는다. 로봇 쪽 작업 입력이 제공되고 지원 action 및 요청 schema가 확인돼야 한다. 이번 작업에서는 로봇 설정·서비스·프로세스를 변경하지 않았다.

## 검증

```bash
npm run lint
npm test -- --runInBand
npm run test:ros2-bridge
npm run build:all
```

Jest에는 R_006 실제 수집 graph fixture, ROS1 회귀 테스트, ROS2 namespace/domain/소유자 검사, 액션 및 실제 HTTP/WebSocket 전송 검증이 포함된다. Python 테스트는 rclpy 의존성을 모의해 프로토콜·QoS·타입·실패·취소 처리를 검증한다. 이 테스트는 실제 ROS2 DDS 및 하드웨어 시험을 대체하지 않는다.

브라우저에서 로그인, 노드별 Params 조회/변경, R_006 action 목록, 초기 위치 메시지 및 ROS1 모드 유지 여부를 모의 RPC로 확인했다. 2026-10-12 R_025의 그래프·서비스 타입·ActionInfo와 지도/pose/scan/배터리/상태 수신은 실제 로봇에서 조회했다. RouteNavigation의 입력·저장·재편집·속도 제거는 모의 RPC 브라우저로, 생성 JSON은 실제 C++ 계약 검증기로 확인했다. 실제 이동·도킹·리프트·파라미터 변경은 실행하지 않았다. 2026-10-09 r56 읽기 전용 SSH 확인은 `No route to host`로 실패하여 실제 브리지 실행과 지도 스트림·모드 전환·조그·Task·충전은 검증하지 않았다.

구현 API 확인은 [rclpy Jazzy action client](https://github.com/ros2/rclpy/blob/jazzy/rclpy/rclpy/action/client.py), [ROS2 메시지 변환](https://github.com/ros2/rosidl_runtime_py/blob/jazzy/rosidl_runtime_py/convert.py)을 기준으로 했다. 로봇 구조 근거는 [R_006 조사 문서](ros2-r006.md)에 있다.

## 엔지니어 미션 스케줄러 (2026-10-20)

미션 추가에서 대상 로봇(IP·RID·SSH 포트·실로봇/Test Mode 구분), 저장 Task, 실행 조건을 지정한다. 실행 조건은 수동 1회, 간격 반복, 매일 지정 시각, 배터리 임계값이다. 대상은 미션에 고정되므로 다른 로봇을 선택해도 바뀌지 않는다. 기존 대상 없는 미션은 자동 활성화하지 않으며 수정에서 대상과 Task를 확인·저장하고 활성화해야 한다.

자동 실행은 엔지니어 로그인 + AUTO + ‘예약 시작’에서만 동작한다. 예약 정의는 브라우저에 저장하고 실행은 해당 브라우저 탭에서 수행한다. 브라우저 종료·절전·백그라운드 제한으로 놓친 예약을 복귀 후 몰아서 실행하지 않는다. 서버의 24시간 백그라운드 스케줄러가 아니다. 새로고침·로그아웃·MANUAL 전환·활성 로봇 변경 시 예약 실행은 중지된다. ‘예약 중지’는 미래 예약만 중지하며 이미 전송한 로봇 Task의 취소는 ‘실행 취소’로 별도 요청한다.

저장 Task는 기존 ActionSender의 ROS1/ROS2 검증·변환 경로를 사용한다. 무한 반복 Task는 예약할 수 없다. ROS2의 Mission 1개·loop_flag=1, 등록 Action, RouteNavigation schema/map/frame/속도와 파라미터 조건을 유지한다. 저장 Task가 변경되면 미션을 수정해 재확인해야 한다. 실행 준비 중 대상 연결, 권한, 예약 상태 또는 미션 정의가 바뀌면 실제 전송 직전에 중단한다. ‘형식 확인’은 로봇에 Task를 전송하지 않는다.

모든 실행에는 15초 이내 수신된 유효한 배터리 SOC가 필요하다. 미수신·NaN·범위 밖·ROS2 percentage=-1은 0%와 구분해 차단한다. 충전 중에는 실제 action_type=16(DockingOut)으로 시작하는 Task만 예외를 적용하며 표시 이름으로 예외를 주지 않는다. ROS2 RouteNavigation 내부 도킹 단계는 이 예외로 추정하지 않는다.

각 실행은 고유 Task ID를 사용하고 대상 로봇의 실제 결과 토픽 또는 Test Mode 결과 이벤트로 완료·실패·취소를 추적한다. 전송 승인이나 취소 요청 승인은 완료가 아니다. 다른 Task의 결과는 무시한다. 결과 확인 시간 초과·전송 후 응답 유실은 ‘상태 미확인’으로 남기고 자동 재전송하지 않는다. 이미 실행한 Task와 다른 Task가 현재 표시되면 로봇 전체 취소 서비스를 임의로 보내지 않는다.

서버 `/api/scheduler`는 엔지니어 전용 실행 예약을 관리한다. acquire/release/reconcile API는 로봇 명령을 실행하지 않는다. 실행 예약은 `runtime/mission-scheduler-reservations.json`에 원자적으로 저장되고 서버 재시작에도 남는다. 브라우저의 감시가 끊겼다고 로봇 Task가 끝났다고 판단하거나 예약을 자동 만료시키지 않는다. 기록이 손상되거나 저장에 실패하면 새 실행을 차단한다. ‘서버 실행 추적 새로고침’에서 남은 기록을 확인하고 실제 로봇의 Task 종료를 확인한 뒤 ‘추적 해제’를 수행한다. 추적 해제 자체는 로봇을 정지/취소하지 않는다. 다른 서버 인스턴스에 걸친 분산 스케줄링은 범위에 포함하지 않는다.

스케줄러 초기 구현은 단위/회귀 테스트, 실제 인증·예약 저장 서버를 사용하는 Chromium 화면 검증, 모의 ROS1/ROS2 서비스·결과·RouteNavigation 요청 검증, Test Mode 종료 이벤트 검증, Linux 단독 실행 파일 smoke test 및 Windows 빌드로 확인했다. 물리 로봇으로 Task/Jog/Lift/충전/취소/파라미터 쓰기 명령을 전송하지 않았다. 이 초기 검증 시점에는 R_006 SSH가 timeout, R_025 SSH가 no route여서 실제 IPC 메시지 계약/실시간 데이터를 확인하지 못했으며 Windows OS에서 실행한 결과도 아니다. 이후 R_006의 읽기 전용 연결에 성공해 확인한 결과와 최종 소스 검증 범위는 문서 상단 개선 스냅샷을 따른다.
