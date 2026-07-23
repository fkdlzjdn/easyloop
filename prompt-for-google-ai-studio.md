# EasyLoop - Google AI Studio 재구현 프롬프트

아래 프롬프트를 Google AI Studio에 붙여넣으세요.

---

## 프롬프트

```
당신은 풀스택 웹 개발 전문가입니다. 아래 명세를 기반으로 "EasyLoop"라는 자율주행 로봇(AMR) 맵핑/관제/진단 웹 애플리케이션을 처음부터 구현해주세요.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. 프로젝트 개요
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

EasyLoop는 산업용 자율주행 로봇(AMR)의 SLAM 맵핑과 루프 클로저를 지원하고 현장에서 모니터링/제어/진단하는 SPA(Single Page Application)입니다.

- 한 화면에서 최대 4대의 로봇을 동시 연결/모니터링
- ROS 1 (Noetic) 환경, rosbridge WebSocket으로 통신
- SSH/SFTP로 원격 터미널/파일 관리
- 폐쇄 네트워크(AP) 환경에서 동작하도록 설계

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2. 기술 스택
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[백엔드]
- Node.js + Express.js
- ws (WebSocket 서버) — ROS Bridge 프록시 + SSH 터미널
- ssh2 — SSH/SFTP 연결
- multer — 파일 업로드
- compression — Gzip

[프론트엔드]
- Vanilla JavaScript (프레임워크 없음)
- HTML5 Canvas — 지도/LiDAR 시각화
- xterm.js (5.3.0) — 터미널 에뮬레이터
- ROSLIB.js (1.0.1) — ROS WebSocket 클라이언트
- CSS3 — 다크/라이트 모드, CSS 변수 기반 테마

[프로토콜]
- ROS 1 rosbridge_websocket (WebSocket)
- SSH/SFTP (ssh2)
- HTTP REST API

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
3. 프로젝트 구조
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

easyloop/
├── server.js                    # Express 메인 서버
├── package.json
├── .env                         # PORT, SHARED_PASSWORD
├── config/
│   ├── robots.json              # 로봇 목록 (IP, SSH 계정, 포트)
│   └── robot-templates.json     # 로봇 모델 템플릿
├── server/
│   ├── auth.js                  # 토큰 기반 인증 (쿠키, 12시간 TTL)
│   ├── rate-limit.js            # IP별 요청 제한
│   ├── ssh.js                   # SSH 연결 관리
│   ├── robots-config.js         # 로봇 설정 파일 관리
│   ├── validation.js            # 입력 검증
│   ├── tunnel-manager.js        # SSH 포트 포워딩 터널
│   └── routes/
│       ├── auth.js              # POST /api/auth/login|logout, GET /api/auth/status
│       ├── robots.js            # CRUD /api/robots, GET scan, scan-subnet, templates
│       ├── ssh.js               # POST /api/ssh/connect|exec|exec-sequence|disconnect
│       ├── sftp.js              # POST /api/sftp/list|download|upload
│       └── tunnel.js            # POST /api/tunnel/start|stop|stop-all, GET status|list
├── public/
│   ├── index.html               # SPA 메인 페이지
│   ├── css/style.css            # 다크모드 기본 스타일
│   ├── locales/                 # i18n (en.json, ko.json, ja.json, zh.json)
│   └── js/
│       ├── app.js               # 메인 SPA (인증, 탭, 로봇 슬롯 관리)
│       ├── ros-manager.js       # ROS 연결, 지도/포즈/LiDAR 렌더링, BMS, Hz 모니터
│       ├── action-sender.js     # TARU 서비스 호출 (9가지 액션 타입)
│       ├── ssh-terminal.js      # 멀티 터미널 (xterm.js, 최대 4개)
│       ├── file-transfer.js     # SFTP 브라우저 (드래그&드롭 업로드)
│       ├── docking-test.js      # 도킹 테스트 (8가지 도킹 타입)
│       ├── test-mode.js         # 시뮬레이션 모드 (로봇 없이 테스트)
│       ├── ros-info.js          # 노드/토픽/서비스/파라미터 브라우저
│       ├── dashboard.js         # 대시보드 위젯
│       ├── diagnostics.js       # 시스템 진단 (Boot Check, 30s Monitor)
│       ├── health-check.js      # 원클릭 헬스체크
│       ├── sysinfo.js           # CPU/MEM/Disk/Temp 모니터
│       ├── smart-alarm.js       # 조건 기반 알람
│       ├── jog-control.js       # 수동 조종 (cmd_vel)
│       ├── commands.js          # SSH 커맨드 스니펫 저장/실행
│       ├── init-setup.js        # 초기 설정 위저드
│       ├── i18n.js              # 다국어 처리
│       └── ... (기타 모듈)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
4. 백엔드 상세 명세
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

4.1 server.js (메인 서버)
- Express + compression 미들웨어
- 인증 미들웨어: /api/* (auth 제외) 모든 요청에 토큰 검증
- Rate limiting: 인증 5회/분, 명령 60회/분
- WebSocket 엔드포인트 2개:
  (a) /ws-proxy?target=IP:PORT — 브라우저 ↔ ROS Bridge 프록시
      - 타겟 IP는 사설 IP만 허용 (127.*, 10.*, 172.16-31.*, 192.168.*)
      - 포트 범위: 9000-9100
  (b) /ws — SSH 터미널 WebSocket
      - base64 인코딩으로 바이너리 데이터 전송
- 테스트 모드: POST /api/testmode/start|stop
  - 로컬에서 roscore, rosbridge_websocket, rosapi 프로세스 스폰
- 프로세스 종료 시 자식 프로세스 자동 정리

4.2 인증 (server/auth.js)
- 공유 비밀번호 기반 (SHARED_PASSWORD 환경변수)
- 48바이트 hex 랜덤 토큰 생성
- 인메모리 세션 저장 (Map), 12시간 TTL
- HttpOnly + SameSite=Strict 쿠키
- Authorization: Bearer 헤더 폴백

4.3 SSH 관리 (server/ssh.js)
- SSH 키 우선 (~/.ssh/id_rsa), 비밀번호 폴백
- 연결 타임아웃: 10초
- 연결 풀링

4.4 터널 매니저 (server/tunnel-manager.js)
- SSH 포트 포워딩: 127.0.0.{robotNum}:9090 → Robot:9090
- sshpass로 비밀번호 전달 (환경변수 방식, ps 노출 방지)
- 프로세스 라이프사이클 관리

4.5 API 엔드포인트 요약
- POST /api/auth/login {password} → 토큰 + 쿠키
- GET /api/robots → 로봇 목록
- POST /api/robots → 로봇 추가/수정
- DELETE /api/robots/:id
- GET /api/robots/scan → 전체 로봇 연결 확인
- GET /api/robots/scan-subnet?subnet=192.168.1 → 서브넷 스캔
- POST /api/ssh/exec {host, user, password, command} → stdout
- POST /api/ssh/exec-sequence {host, user, password, steps:[{cmd, wait}]}
- POST /api/sftp/list {host, user, password, path}
- POST /api/sftp/download {host, user, password, remotePath} (최대 100MB)
- POST /api/sftp/upload (multipart form-data)
- POST /api/tunnel/start {robotIp, robotNumber, sshUser, sshPassword}
- GET /api/tunnel/list

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
5. 프론트엔드 상세 명세
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

5.1 레이아웃 (SPA)

[비밀번호 오버레이] → 로그인 후 →
[헤더] 로봇 선택기 | BMS 게이지 | 운전모드 | 테마 토글
[메인 레이아웃]
  ├─ [지도 패널] (좌측) — Canvas 기반 2D 시각화
  │   - 점유격자 지도 (회전/팬/줌)
  │   - 로봇 포즈 (5가지 아이콘: AMR, 화살표, 원, 삼각형, 거북이)
  │   - LiDAR 포인트 클라우드 오버레이
  │   - 네비게이션 골 설정 (클릭)
  │   - 포즈 초기화 (드래그)
  │   - 이동 궤적 (Breadcrumb, 500포인트)
  │   - POI 마커
  │   - No-Go Zone 그리기
  │
  └─ [탭 컨테이너] (우측) — 10개 탭
      1. Dashboard — 상태 요약, 워크스테이트 타임라인, BMS 트렌드 그래프
      2. ROS Control — 노드/토픽/서비스/파라미터 브라우저, 검색, 즐겨찾기
      3. Tasks — 액션 전송 (9가지 타입), 큐 관리, 즐겨찾기, 실행취소
      4. Camera — 압축 이미지 스트리밍
      5. Terminal — xterm.js 기반 멀티 터미널 (최대 4개)
      6. Batch — 커맨드 스니펫 저장/실행
      7. Files — SFTP 파일 브라우저, 드래그&드롭 업로드
      8. Docking — 도킹 테스트/최적화
      9. Monitor — 시스템 리소스, 토픽 Hz, 알람
     10. Scheduler — 미션 스케줄러
     11. Diagnostics — 부트체크, 30초 안정성 모니터, 점수판

5.2 핵심 JS 모듈 명세

[app.js] — 메인 SPA 컨트롤러
- 비밀번호 인증 오버레이
- 탭 네비게이션 (저장/복원)
- 멀티 로봇 슬롯 관리 (최대 4대)
  robotSlots: [{index, robotId, ip, connected, ros, bms, workState, pose, tfReceived, subscriptions}]
- 이벤트 로그 (200건, 7일 보관)
- 토스트 알림 시스템
- 다크/라이트 테마 토글
- 폰트 크기 조절 (S/M/L/XL)
- localStorage 안전 래퍼

[ros-manager.js] — ROS 통신 + 시각화 (가장 큰 모듈)
- 슬롯별 ROS 연결/해제/재연결 (지수 백오프)
- 토픽 구독 관리 (throttle_rate 적용)
- Canvas 지도 렌더링:
  - 점유격자 (OccupancyGrid 메시지)
  - 로봇 포즈 (TF 또는 amcl_pose)
  - LiDAR 스캔 (LaserScan 메시지)
  - 네비게이션 골, 포즈 설정 (드래그)
  - 팬/줌/회전 (마우스/터치)
- BMS 모니터링: SOC, 전압, 전류, 충전 상태, 충전 ETA 계산
- 토픽 Hz 모니터 (1초 간격 갱신): bms, workstate, pose, map, lidar
- 워크스테이트 추적 + 타임라인 Canvas
- POI (관심지점) 관리 (추가/삭제/이동)
- Breadcrumb 궤적 (500포인트)
- 레이턴시 모니터링 (RTT)
- 커스텀 토픽 매핑

[action-sender.js] — TARU 서비스 호출
- 9가지 액션 타입:
  0x01 Way_Point (x, y, theta)
  0x02 Basic_Move (전진/후진/회전)
  0x03 Docking_Cmd
  0x04 Goal_Cancel
  0x05 Map_Switch
  0x06 LocInit (위치 초기화)
  0x07 Charge_Cmd
  0x08 Lift_Cmd
  0x09 Conveyor_Cmd
- 각 액션별 args + params 폼 자동 생성
- 액션 큐 + 실행취소/다시실행 (30건)
- 즐겨찾기 저장 (localStorage)
- 맵 클릭으로 웨이포인트 선택
- 반복 실행 (루프 카운트)

[docking-test.js] — 도킹 테스트
- 8가지 도킹 타입: L_dock, LV_dock, Cradle_dock, Rack_dock, Aruco_dock 등
- 15개 파라미터 배열 (dock_dist, scan_view, marker_size 등)
- 반복 테스트 + 성공률 통계
- 파라미터 최적화 (브루트포스 탐색)
- 결과 JSON/CSV 내보내기

[test-mode.js] — 시뮬레이션 모드
- 실제 로봇 없이 전체 UI를 테스트할 수 있는 가상 환경
- 가상 토픽 발행 (BMS, 포즈, 워크스테이트, LiDAR)
- 물리 기반 로봇 이동 (속도 적분)
- 지도 기반 LiDAR 레이캐스팅
- 가우시안 노이즈 적용
- 50ms 틱 기반 업데이트

[diagnostics.js] — 시스템 진단
- Boot Check: 노드/토픽/TF/서비스/상태값/시스템 리소스 일괄 진단
  - 기대 노드 목록 (P0/P1/P2 우선순위)
  - 기대 토픽 + Hz 범위 검증
  - TF 체인 확인 (map→odom→base_link)
  - 핵심 서비스 존재 확인
  - BMS SOC, 워크스테이트, ROS Bridge 상태
  - CPU/MEM/Disk/Temp (SSH)
- 30s Steady-State Monitor:
  - rosout_agg 구독 (ERROR/FATAL 카운트)
  - Hz 안정성 분석 (변동계수)
  - 노드 생존 비교 (시작 vs 종료)
  - emergency_state, static_stopflag 모니터링
  - CPU/MEM 5초 간격 샘플링
- 가중 점수 계산 (0-100, 초록/노랑/빨강)

[ssh-terminal.js] — 멀티 터미널
- xterm.js + FitAddon + SearchAddon
- 최대 4개 동시 세션
- base64 인코딩 전송
- 명령어 히스토리 (100건)
- 터미널 리사이즈 전파

[기타 모듈]
- health-check.js: 원클릭 ROS/SSH/네트워크 헬스체크
- sysinfo.js: CPU/MEM/Disk/Temp/네트워크 10초 갱신
- smart-alarm.js: 복합 조건 알람 (BMS < 20% AND Temp > 50°C 등)
- jog-control.js: 수동 조종 (cmd_vel 퍼블리시)
- commands.js: SSH 커맨드 스니펫 저장/실행
- init-setup.js: 초기 설정 위저드 (네트워크, SSH, ROS, 지도)
- error-codes.js: 에러 코드 DB 조회
- incident-report.js: 장애 리포트 자동 생성
- rosout-viewer.js: 실시간 로그 스트리밍
- param-tuning.js: ROS 파라미터 실시간 조정
- network-config.js: 네트워크 설정 (IP/DNS/게이트웨이)
- map-file-manager.js: 맵 파일 업로드/전환
- map-version-control.js: 맵 백업/복원
- no-go-zone-editor.js: 금지 구역 그리기
- fleet-dashboard.js: 멀티 로봇 요약 뷰
- robot-comparison.js: 로봇 설정 비교
- rosbag-control.js: rosbag 녹화/재생
- performance-profiler.js: 노드별 CPU/메모리 프로파일링
- file-diff.js: 설정 파일 비교
- i18n.js: 다국어 (ko, en, ja, zh)

5.3 CSS 디자인 시스템
- 다크모드 기본 (GitHub Dark 계열)
  --bg-base: #0d1117
  --text-primary: #e6edf3
  --accent: #58a6ff
  --success: #3fb950
  --danger: #f85149
  --warning: #d29922
- 라이트모드 토글
- 반응형 (데스크톱/태블릿/모바일)
- Sora 폰트 (Google Fonts)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
6. 로봇 통신 프로토콜
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

6.1 ROS 토픽 (rosbridge WebSocket)
- /{robotId}/bms (std_msgs/Float32MultiArray) → [voltage, current, soc]
- /{robotId}/robot_state (syscon_msgs/RobotState) → workState 정수
- /{robotId}/amcl_pose (geometry_msgs/PoseWithCovarianceStamped) → x, y, yaw
- /{robotId}/odom (nav_msgs/Odometry) → 오도메트리 폴백
- /{robotId}/map (nav_msgs/OccupancyGrid) → 점유격자
- /{robotId}/scan (sensor_msgs/LaserScan) → LiDAR
- /tf (tf2_msgs/TFMessage) → TF 트리
- /{robotId}/rosout_agg (rosgraph_msgs/Log) → 로그
- /{robotId}/emergency_state (std_msgs/Int32)
- /{robotId}/static_stopflag (std_msgs/Bool)

6.2 ROS 서비스
- /{robotId}/TARU/goal → 액션 전송 (네비게이션, 도킹, 충전 등)
- /{robotId}/move_base/make_plan
- /{robotId}/move_base/clear_costmaps
- /{robotId}/global_localization
- /{robotId}/request_nomotion_update

6.3 ROSLIB.js 연결 패턴
```javascript
const ros = new ROSLIB.Ros({ url: 'ws://IP:9090' });
const topic = new ROSLIB.Topic({
  ros, name: '/R001/bms',
  messageType: 'std_msgs/Float32MultiArray',
  throttle_rate: 150  // ms
});
topic.subscribe(callback);
```

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
7. 보안
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- 공유 비밀번호 기반 인증 (폐쇄 네트워크 전제)
- 48바이트 랜덤 토큰, 12시간 TTL
- HttpOnly + SameSite=Strict 쿠키
- WebSocket 프록시: 사설 IP + 포트 9000-9100만 허용
- SSH 비밀번호: 환경변수로 전달 (ps 노출 방지)
- 입력 검증: 문자열 길이, 숫자 범위, 배열 크기
- Rate limiting: IP별 슬라이딩 윈도우

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
8. 구현 요청사항
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

위 명세를 기반으로 전체 애플리케이션을 구현해주세요.

우선순위:
1. 백엔드 서버 (server.js + 모든 라우트 + 인증 + WebSocket 프록시)
2. 프론트엔드 SPA 쉘 (index.html + app.js + CSS 다크모드)
3. ROS 연결/지도/포즈 시각화 (ros-manager.js)
4. SSH 터미널 (ssh-terminal.js)
5. 파일 전송 (file-transfer.js)
6. 액션 전송 (action-sender.js)
7. 진단/모니터링 (diagnostics.js, health-check.js, sysinfo.js)
8. 도킹 테스트 (docking-test.js)
9. 테스트 모드 시뮬레이션 (test-mode.js)
10. 기타 모듈 (알람, 커맨드, 초기설정 등)

코드 스타일:
- 프레임워크 없이 Vanilla JS
- 각 모듈은 전역 const 객체 패턴 (예: const App = { ... })
- DOMContentLoaded에서 init() 호출
- fetchWithTimeout() 유틸리티 함수 공통 사용
- App.toast(message, type) 으로 알림
- 한국어 주석 허용

각 파일의 전체 코드를 생성해주세요. 파일이 너무 길면 파일 단위로 나눠서 출력해도 됩니다.
```

---

## 사용 팁

1. Google AI Studio는 한 번에 전체 코드를 생성하기 어려울 수 있으므로, "우선순위 1-3번까지만 먼저 구현해줘" 식으로 나눠서 요청하세요.
2. 각 모듈별로 "action-sender.js를 구현해줘. 위 명세의 5.2 참고" 식으로 개별 요청할 수도 있습니다.
3. Gemini 2.5 Pro의 100만 토큰 컨텍스트를 활용하려면, 기존 코드를 첨부하고 "이 코드를 참고해서 나머지를 구현해줘"라고 요청하는 것이 효과적입니다.
