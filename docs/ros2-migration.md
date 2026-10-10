# EasyLoop v1.4.0 — ROS1 / ROS2 사용 안내

ROS1 rosbridge 연결과 기존 기능을 유지하면서 Syscon SPX ROS2 Jazzy 환경을 추가했다. 구현 브랜치는 `feat/ros2-migration`이며 R_006 / sl400_vri의 수집 자료를 기준으로 작성했다.

## 실행

로컬 작업 경로는 `/home/syscon/repo/easyloop-ros2-r006`이다. 실제 worktree는 `/home/syscon/workspace/projects/easyloop-ros2-r006`에 있다. 원래 `/home/syscon/repo/easyloop`의 `develop` 및 미커밋 수정은 유지된다.

```bash
cd /home/syscon/repo/easyloop-ros2-r006
npm start
```

이 PC에서는 기존 `.env`를 복사해 같은 로그인 설정을 사용한다. 비밀번호와 환경 파일은 Git 및 실행 파일에 포함하지 않는다.

별도 PC에서 패키지를 사용할 때는 `.env.example`을 실행 파일 옆의 `.env`로 복사하고 `SHARED_PASSWORD`를 설정한다. Linux는 `./easyloop`, Windows는 `EasyLoop.exe`로 실행할 수 있다. `.env`의 `PORT` 또는 프로세스 환경변수로 포트를 지정한다. 기존 Windows 네트워크 설정 배치 파일은 선택적으로 사용한다.

## 로봇 연결

1. 로봇 관리에서 IP, RID, SSH port를 등록한다. R_006 기준 IP는 `192.168.20.56`, RID는 `R_006`, SSH port는 `22`다.
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
| Task / Quick Task | 기존 검증된 scheduler | 입력 서비스·지원 action·모델 정보를 확인한 경우 사용 |
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

## R_006의 작업 및 주행 제한

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

브라우저에서 로그인, 노드별 Params 조회/변경, R_006 action 목록, 초기 위치 메시지 및 ROS1 모드 유지 여부를 모의 RPC로 확인했다. 2026-10-09 r56 읽기 전용 SSH 확인은 `No route to host`로 실패하여 실제 브리지 실행과 지도 스트림·모드 전환·조그·Task·충전은 검증하지 않았다.

구현 API 확인은 [rclpy Jazzy action client](https://github.com/ros2/rclpy/blob/jazzy/rclpy/rclpy/action/client.py), [ROS2 메시지 변환](https://github.com/ros2/rosidl_runtime_py/blob/jazzy/rosidl_runtime_py/convert.py)을 기준으로 했다. 로봇 구조 근거는 [R_006 조사 문서](ros2-r006.md)에 있다.
