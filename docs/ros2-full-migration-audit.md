# ROS2 전체 기능·액션·파라미터 검토 — 2026-10-12

대상: EasyLoop v1.5.0, `feat/ros2-migration`, `192.168.20.75:2222`의 **R_025 / stl1000_ros2 / ROS2 Jazzy**. 원래 `develop`의 ROS1 코드와 미커밋 변경은 보존한다.

연결만 성공한 상태에서 모든 기능의 이관이 완료됐다고 판단할 수는 없다. 이번 검토에서 RouteNavigation 입력 누락, Lift의 타입·모드·단위, ROS1 전용 도킹 시험과 초기 설정, 진단 기대 노드의 차이를 확인하고 수정했다. 실제 로봇은 읽기 전용으로 조회했으며, 새 runtime_contract RPC도 실제 GetParameters 응답으로 확인했다. 이동·도킹·리프트·충전·모드 전환·지도 변경·파라미터 쓰기는 실행하지 않았다.

## 실제 계약과 액션 대응

`spx/task/actions/info`가 반환한 등록 액션은 `RouteNavigation(48, route_navigation)`과 `StandBy(7, standby)`다. TaskGoal ingress는 활성 상태지만 현재 production 경계는 Mission 하나, 하나 이상의 Action, `loop_flag: 1`만 지원한다. 다른 액션을 같은 이름의 ROS2 패키지에서 발견했다고 해서 이 Task 인터페이스가 지원하는 것은 아니다.

| 기존 기능 | 실제 ROS2 대응 | 이번 처리 |
|---|---|---|
| WayPoint(1) | RouteNavigation(48), v2 `ROBOT_FREESPACE` | 목표 좌표 입력·지도 선택·현재 위치 추가, 현재 위치부터 계획 |
| TrajectoryFollowing(21) | RouteNavigation(48), `PROVIDED_TRAJECTORY` | LINE 구간의 경로점 입력, 후진/폭/장애물 정책 |
| 자유 경로 | RouteNavigation(48) | 샘플링한 경로점으로 LINE 구간 구성 |
| NURBS 경로 | v2 NURBS geometry | 제어점·degree·knots·weights 계약 생성, 곡선 미리보기 |
| StandBy(7) | StandBy(7) | 인자 생략 또는 음수가 아닌 정수 timeout, 기존 wakeup endpoint 사용 |
| 독립 Docking(8)/DockingOut(16) | 현재 Task catalog에 없음 | 기존 버튼 차단; RouteNavigation의 도킹 연결 인자와 상세 JSON 제공 |
| Lift Task(18/22 등 기존 모델별 의미) | 현재 Task catalog에 없음 | 임의 type 치환 차단; 수동 Lift는 별도 실제 서비스 사용 |
| BasicMove/Turntable/Conveyor/ChangeMap/Forklift Task | 현재 Task catalog에 없음 | 등록된 로봇에서만 표시/전송; 이 로봇에서의 대체 실행을 만들지 않음 |

경로 계약은 `spx.route_contract.v1/v2`를 구분한다. R_025의 현재 runtime은 **v2 / mapId `normal` / frame `map` / maximumSpeed `0.25 m/s`**이다. v2 LINE에는 weight/degree/knot_vector를 넣지 않는다. NURBS에는 필요한 곡선 필드를 넣는다. 계약 식별자는 SDK의 UTF-8 길이 규칙으로 생성하고 실제 task/action 식별자로 전송 직전에 다시 연결한다. map/frame/schema 불일치, 중복 파라미터, 상충하는 JSON carrier, 미등록 액션, 실행 backend 미사용은 전송 전에 차단한다.

도킹 인자는 새 `[is_charge,direction,scan_type]` 3개다. 기존 네 번째 end-condition은 재사용하지 않는다. 목표·오프셋·전환 계약은 `docking_target_selection`, `docking_parameters`, `docking_transition`, `docking_approach`의 실제 JSON을 사용한다. 단순 폼은 공통 입력을 제공하며 혼합 경로·가중 NURBS는 상세 JSON에서 편집한다. 로봇 모델별 도킹 구성 존재 여부와 실제 정밀도는 아직 시험하지 않았다.

## 변경된 파라미터

| 기존 이름/형식 | ROS2 이름/위치 | 처리 |
|---|---|---|
| Task의 `max_trans_vel` | ActionParam `maximum_speed_mps` | 대응 변환, 양수 및 `factsheet.maximum_speed` 상한 검사 |
| `backward_driving` / `lane_direction=3` | edge `motion_direction=BACKWARD`, `reverse_allowed=true` | 방향 변환 |
| `lane_name` | route의 이름 | lane_name을 route 이름으로 사용; 원본 별도 백업 |
| WayPoint `[x,y,yaw]` | v2 goal node pose, `CURRENT_ROBOT_POSE` start | route_contract_json 생성 |
| Trajectory `[x,y,...,yaw]` | nodes 및 LINE edges | 좌표·마지막 yaw 유지 |
| `xy_goal_tolerance`, `yaw_goal_tolerance`, `max_rot_vel`, 기존 planner/target_cfg 등 | Nav2 노드 설정 / tracking / docking 계약 등 | 의미가 같다는 근거가 없어 일괄 이름 치환하지 않음; 변환 검토에 이름 표시 |
| ROS1 전역 `/parameter` | ROS2 `/node::parameter` | 실제 선언 이름·타입 조회, 쓰기 거부 사유 표시 |
| Lift feedback의 기존 각도 표시 | native `LiftFeedback.height`, mm | `/100` 및 ° 표시 제거 |

**v1** RouteNavigation의 추가 ActionParam은 `start_heading_policy.enabled/source/start_align_threshold_rad/complete_tolerance_rad/max_angular_speed/timeout_sec`이다. 가져온 Task 편집 시에는 보존하지만, v2 실행 경로에서는 이 override를 사용하지 않으므로 v2 전송 전에 검토 대상으로 차단한다. ROS1의 이름을 그대로 넣어 로봇이 무시하는 일을 막기 위해 확인되지 않은 RouteNavigation 파라미터는 실행 전에 차단한다. 일반 ROS2 Params 화면은 실제 노드의 선언 목록을 사용하므로 고정된 ROS1 파라미터 목록에 의존하지 않는다. 조회는 최대 30개 결과와 부분 결과 상태를 표시하는 기존 제한이 있다.

기존 Task의 **ROS2 경로 변환 검토**는 WayPoint/TrajectoryFollowing만 대상으로 한다. 대응하지 못한 파라미터를 보여주고 브라우저 확인을 거쳐 새 queue를 만든다. 원본 queue를 localStorage에 timestamp 백업한다. Mission을 합치거나 반복 횟수를 자동으로 바꾸지 않는다. 네이티브 JSON, 최대 속도, 도킹 인자는 저장/재편집/마지막 입력 복원 시 유지하며 최대 속도를 비우면 기존 값도 제거한다.

## 전체 기능 검토표

‘코드·계약 검증’은 하드웨어 동작 성공을 뜻하지 않는다.

| 기능군 | 코드·계약 상태 | 실제 R_025 확인 / 남은 범위 |
|---|---|---|
| 접속·RID/domain/DDS | SSH/rclpy, 실행 중인 bringup 환경 확인 | 실제 연결 및 RID R_025 확인 |
| graph·topic/service/action 브라우저 | ROS2 type·namespace·QoS | 67 node entries / 273 topics / 543 services / 3 actions 조회 |
| 지도·pose·scan·배터리·상태·odom | native 메시지와 timestamp 처리 | 실제 데이터 수신; camera/모든 IO는 미시험 |
| Task/Quick Task·YAML·미리보기 | RouteNavigation 입력·변환·저장·wire guard | ActionInfo 조회, 생성 계약 C++ SDK 및 모의 브라우저 검증; goal 전송 미실행 |
| pause/resume/cancel/wakeup·결과 | native Task 서비스/피드백 | endpoint 타입 조회; 실제 작업 중 전환 미시험 |
| Params·설정 비교 | 노드별 선언 타입 및 변경 실패 처리 | 실제 구조 확인; write 미실행 |
| 조그 | teleop→mux→safety gate 경로 및 신호 freshness | 실제 endpoint 연결 확인; 움직임 미시험 |
| Lift | native `spx_device_msgs/srv/LiftCmd`, StringSrv cancel, feedback mm | AUTO/IDLE/STO와 drive MANUAL 조건 분리; 구동 미시험 |
| Conveyor/Turntable | graph·타입에 따라 표시 | 이 모델의 미지원 기능을 legacy 인자로 호출하지 않음; 해당 장비 미시험 |
| 충전 relay·BMS | 실제 relay endpoint, feedback/전류 구분 | 자동 도킹 및 실제 충전 미시험 |
| SLAM/LIFELONG/NAV·지도 저장/로드·초기 위치 | SPX/Nav2 실제 서비스·메시지 타입 | 현재 NAV 및 lifecycle 조회; 변경 동작 미시험 |
| 일반 목적지 버튼 | NavigateToPose 서버 존재 여부 확인 | 이 로봇에 서버 없음; Task의 RouteNavigation으로 입력 |
| Diagnostics | ROS2 wheel/mux/gate/amcl/planner/controller 기반 기대값 | Noetic 전용 기대값 제거; 실제 fault 해소는 별도 |
| rosbag | `ros2 bag` 및 directory/db3/mcap 지원 | record/play 미실행 |
| SSH/SFTP·터미널·시스템 모니터·파일/로그·CAN 화면 | transport를 공유하거나 ROS 버전 분기 | 파일 쓰기·CAN write·서비스 재시작 미실행 |
| 반복 도킹 시험·ROS1 초기 설치/hosts/network/scorpion 변경 | ROS2에서 차단 및 안내 | ROS2 시험 노드/초기 provisioning 전체 이관은 미구현 |
| 설정 일괄 복사 | ROS1→ROS2 자동 복사 차단 | ROS2 노드별 Params 개별 편집 사용; 일괄 의미 변환 미구현 |
| ROS1 | 기존 transport·액션·폼 유지 | 회귀 테스트 통과; 원래 develop worktree 미변경 |

## 검증 근거와 한계

- Jest 54 suites / 543 tests 통과, ESLint 통과.
- Python bridge protocol 21 tests 통과: runtime_contract의 실제 node GetParameters 조회를 포함.
- 로봇의 `core/spx_route_contract` C++ parser/validator 소스를 로컬에서 컴파일하여 goal, goal-chain, line, reverse-line, line-chain, NURBS, v1의 7개 생성 예제 모두 통과.
- Chromium 모의 RPC 브라우저 11 checks 통과: 목적지·지정 경로·NURBS·속도·변환 검토·queue 재편집·도킹 인자/속도 복원·속도 제거·ROS1 폼 확인, page errors 0.
- Linux/Windows standalone 재빌드. 공유 ZIP에는 `.env.example`만 넣고 실제 `.env`는 제외.

실제 로봇의 마지막 수집 VDA 상태에는 이전 작업의 `LOCALIZATION_UNAVAILABLE` FATAL이 있었다. 현재 pose가 수신된다는 사실만으로 runtime 재시도/오류 해소/주행 성공을 보증할 수 없다. 이를 포함해 실제 RouteNavigation goal admission, 주행·정지·취소, 도킹 정밀도·충전·Lift 완료는 현장 기능 시험이 필요하다. 이번 작업은 그 명령을 보내지 않았다.

원본 근거: `/home/syscon/workspace/analysis/2026-10-12_r75_ros2_evaluation/`, `/home/syscon/workspace/analysis/2026-10-12_ros2_full_migration/source/`, `native-validator-results.json`, `browser_route_smoke.py` 및 `route-editor.png`.
