# WORKLOG

## 2026-09-30 — BMA ROSBridge 연결 안정화

- 현장 `R_105` syslog와 EasyLoop 구독 경로를 대조해 수동 RID `r_105`가 잘못된 namespace를 만드는 문제를 확인했다.
- 수동 입력, 저장 설정 복원, slot 생성, ROS 연결, 서버 robot 설정 경계에서 RID를 `R_###` 형식으로 정규화했다.
- BMS/RobotState가 실제 ROS graph에서 확인되지 않은 모델에 대해 전체 monitoring/UI topic을 주기적으로 재구독하던 동작을 제거했다. 검증된 health topic 중 실제 누락된 항목만 복구한다.
- Task goal은 지원하지만 feedback/result/state topic이 없는 로봇에서 `topic: null` subscribe를 보내지 않도록 방어했다.
- 관련 회귀 테스트를 추가했다. `npm run lint`, Jest 49 suites / 502 tests 통과.
- Windows x64 standalone 패키지를 빌드하고 `EasyLoop_Windows_v1.3.0_20261001.zip`으로 묶었다. ZIP 무결성 검사 통과, SHA-256 `68fcc8c273bc1268dda32ea9b187074c09c3d5652493783122f22f18da8ef47a`.
