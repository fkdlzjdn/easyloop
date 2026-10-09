# WORKLOG

## 2026-09-30 — BMA ROSBridge 연결 안정화

- 현장 `R_105` syslog와 EasyLoop 구독 경로를 대조해 수동 RID `r_105`가 잘못된 namespace를 만드는 문제를 확인했다.
- 수동 입력, 저장 설정 복원, slot 생성, ROS 연결, 서버 robot 설정 경계에서 RID를 `R_###` 형식으로 정규화했다.
- BMS/RobotState가 실제 ROS graph에서 확인되지 않은 모델에 대해 전체 monitoring/UI topic을 주기적으로 재구독하던 동작을 제거했다. 검증된 health topic 중 실제 누락된 항목만 복구한다.
- Task goal은 지원하지만 feedback/result/state topic이 없는 로봇에서 `topic: null` subscribe를 보내지 않도록 방어했다.
- 관련 회귀 테스트를 추가했다. `npm run lint`, Jest 49 suites / 502 tests 통과.
- Windows x64 standalone 패키지를 빌드하고 `EasyLoop_Windows_v1.3.0_20261001.zip`으로 묶었다. ZIP 무결성 검사 통과, SHA-256 `68fcc8c273bc1268dda32ea9b187074c09c3d5652493783122f22f18da8ef47a`.

## 2026-10-09 — ROS1 유지 및 ROS2 Jazzy 마이그레이션

- 브랜치 `feat/ros2-r006-mode`에서 기존 `a79d38d` 연결 기반을 확장했다. 원본 `develop`의 미커밋 수정은 그대로 보존하고 이 worktree에 복사해 `9196505`로 반영했다.
- ROS2 실제 bringup의 RID/domain/DDS 환경 확인, 조회 전용 상태, 조그의 mux/safety gate/wheel 연결 확인을 추가했다.
- 노드별 Params, 실제 config_file에 근거한 차상 모델, QoS 전환 재구독, 메시지/time/이미지 변환, 서비스 timeout, 액션 feedback/result/cancel을 구현했다.
- R_006 수집 graph에 존재하는 Nav2 LoadMap을 선택하고 pose graph 타입을 보완했다. ROS2 지도 레이어·rosout·초기 위치와 CLI 상세 조회를 이관했다.
- ROS1 접속·명령 및 회귀 동작을 유지하며, ROS2 rosbag 및 PID별 기록/재생 종료를 지원한다. ROS1 설정 일괄 복사는 ROS2에서 실행하지 않는다.
- lint, Jest 53 suites / 523 tests, Python bridge 20 tests 통과. 실제 HTTP/WebSocket 전송, 브라우저 모의 RPC 동작, Linux 패키지 시작/로그인/API 검증 통과. Windows/Linux 빌드와 ZIP 무결성 검증 통과.
- r56 읽기 전용 SSH는 `No route to host`. 로봇 설치·설정·실행 상태를 변경하지 않았으며 실기 지도·주행·Task·충전 검증은 미수행이다. R_006의 NavigateToPose 부재 및 과거 Task ingress 비활성은 로봇의 제공 인터페이스에 따른 제한이다.
- 사용 안내: `docs/ros2-migration.md`. 패키지는 `.env`와 비밀번호를 포함하지 않으며 `.env.example`만 제공한다.
