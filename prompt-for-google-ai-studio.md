# EasyLoop UI·스타일 리팩터링 마스터 프롬프트

> 이 문서 전체를 UI/UX 리팩터링을 수행할 AI 또는 개발자에게 그대로 전달한다.
> 기준 소스: EasyLoop v1.3.0, 2026-07-26 현재 작업 트리.
> 이 문서는 희망 기능 목록이 아니라 **현재 프로그램의 실제 동작, 사용법, 화면 형태, 상태, 제약을 보존하기 위한 소스 기반 명세**다.

---

## 0. 당신의 역할과 최종 목표

당신은 시스콘로보틱스 AMR 현장 엔지니어용 웹 도구 **EasyLoop**의 UI/UX와 시각 스타일을 리팩터링한다.

EasyLoop는 ROS1 AMR의 Mapping, Loop Closure, Navigation, Task 작성·실행, 다중 로봇 관제, SSH/SFTP, 진단, CANopen 점검을 한 화면에서 수행하는 고밀도 산업용 도구다. 일반 소비자용 대시보드가 아니다. 현장 엔지니어가 노트북·태블릿에서 장갑 또는 마우스로 빠르게 조작하며, 폐쇄망에서 로봇과 직접 연결하는 상황을 전제로 한다.

목표는 다음과 같다.

1. 현재 기능을 하나도 잃지 않고 정보 구조, 가독성, 일관성, 반응형 동작, 접근성을 개선한다.
2. Mapping과 Quick Task를 제품의 가장 중요한 작업 흐름으로 유지한다.
3. 로봇 선택, 연결 상태, Work State, BMS, 운전 모드, 긴급 정지 가능성을 항상 명확히 한다.
4. 파괴적이거나 물리 동작을 유발하는 조작은 대상 로봇, 영향, 진행 상태, 성공·실패를 분명히 보여준다.
5. 현재의 다크 산업용 콘솔 정체성은 유지하되, 임의의 “미래형 네온 UI”나 장식 위주 화면으로 바꾸지 않는다.

## 1. 절대 준수사항

### 1.1 기능 보존

- UI·스타일 리팩터링이 범위다. ROS topic/service/message 계약, SSH 명령, API 경로, 데이터 형식, Task YAML 형식, localStorage 키, Test Mode 시뮬레이션 의미를 임의로 변경하지 않는다.
- 소스에 없는 기능을 있는 것처럼 추가하지 않는다.
- 현재 노출된 버튼, 입력, 표, 그래프, 메뉴, 팝오버, 모달, 단축키, 드래그·홀드·지도 클릭 동작을 빠뜨리지 않는다.
- 버튼 이름만 보고 의미를 추측하지 말고 아래의 동작 명세를 따른다.
- 실로봇 동작 버튼의 대상은 항상 **현재 활성 로봇**이다. 다중 로봇 전체에 명령을 보내는 것으로 바꾸지 않는다.
- 연결되지 않은 상태, 로딩, 빈 결과, 부분 수신, 실패, 취소, 권한 없음, Test Mode를 각각 구분한다.
- 엔지니어 권한 기능을 일반 사용자에게 노출하지 않는다.
- 이미 구현된 확인창과 안전 잠금을 줄이거나 우회하지 않는다.
- 프로그램 언어는 한국어 고정이다. 일부 기존 기술 레이블과 ROS 식별자는 영문을 유지한다.

### 1.2 구현 원칙

- 현재 프런트는 Vanilla HTML/CSS/JS다. 프레임워크 전환은 별도 승인 없이는 하지 않는다.
- 페이지 새로고침 없는 단일 화면 구조, 전역 `App`, `RosManager`, 각 기능 모듈의 연동을 보존한다.
- canvas 기반 지도·카메라·그래프와 xterm.js 터미널을 DOM 카드로 대체하지 않는다.
- DOM `id`, JS에서 참조하는 class/data attribute를 바꾸려면 모든 참조를 함께 추적해야 한다.
- 동적 생성 모달과 정적 HTML 모달을 모두 같은 디자인 시스템에 포함한다.
- 코드에 존재하지만 현재 UI 진입점이 없는 기능은 임의로 메뉴에 다시 노출하지 않는다. 이 문서의 “비노출·부분 구현 기능”을 따른다.
- 현재 결선 오류나 미구현 버튼을 UI 리팩터링 과정에서 조용히 고치지 않는다. 별도 이슈로 보고하고 승인 후 처리한다.

### 1.3 안전 UX

- Reboot, 서비스 재시작, 파일 삭제, rosbag 삭제, Task 취소, CAN ID 변경, STO 해제, 모터 주행 시험, 네트워크 적용, `.bashrc`/`hosts` 저장처럼 영향이 큰 동작에는 현재 확인 절차와 경고를 유지한다.
- CAN의 STO에서 `ON`은 안전 정지 활성, `OFF`는 안전 정지 해제다. 색·문구가 반대로 해석되지 않게 한다.
- Jog 버튼은 누르고 있는 동안만 움직이고, 포인터 해제·창 blur·탭 숨김·로봇 전환 시 0 속도를 전송한다.
- Space는 즉시 정지다. 어떤 모달이나 시각 효과도 정지 조작을 방해하지 않아야 한다.
- 실제 ROS/SSH 명령을 실행하는 UI와 Test Mode 시뮬레이션 UI를 명확히 구분한다.

---

## 2. 제품·기술 기준

### 2.1 기술 구성

- Backend: Node.js 18+, Express 4.18, `ws`, `ssh2`, `multer`, `compression`
- Frontend: Vanilla HTML/CSS/JS
- ROS: ROS1, roslib.js 1.0.1, rosbridge WebSocket
- Terminal: xterm.js 5.3.0, fit addon, search addon
- 저장: DB 없음. `config/robots.json`, `config/robot-templates.json`, 브라우저 localStorage
- 배포: `node server.js`, pkg 기반 Windows/Linux 단일 바이너리, Docker
- 기본 포트: 3000. 사용 중이면 다음 빈 포트를 찾는다.
- 외부 CDN 실패 가능성이 있는 폐쇄망 환경을 고려한다.

### 2.2 인증과 역할

로그인 오버레이는 앱 전체를 가린다.

- 제목: EasyLoop
- 역할 라디오: `user` 기본 선택, `engineer`
- 공유 비밀번호 입력
- 한국어 안내문, 로그인 버튼, 오류 메시지
- 서버의 `.env` `SHARED_PASSWORD`로 인증한다.
- 세션은 메모리 저장, 무작위 토큰, 12시간 TTL, HttpOnly, SameSite Strict 쿠키다. HTTPS에서는 Secure를 사용한다.
- 로그인 시도 제한은 IP 기준 분당 5회다.
- 로그아웃 시 ROS, SSH, 터널 등 연결을 정리한다.

역할별 화면:

| 역할 | 보이는 기본 화면 |
|---|---|
| user | Dashboard, Tasks, Camera, Monitor |
| engineer | 모든 화면: Dashboard, ROS Control, Tasks, Camera, Terminal, Batch, Files, Docking, Monitor, Scheduler, Diagnostics, Motor Diag/CAN |

일반 사용자에게 엔지니어 전용 탭과 관련 지도 기능을 CSS로만 흐리게 보이지 말고 실제 탐색 구조에서도 제외한다.

### 2.3 로봇 연결 모델

- 등록 로봇을 slot으로 관리하고 한 대를 활성 로봇으로 선택한다.
- 여러 로봇의 ROS WebSocket 연결은 유지할 수 있지만, topic subscription과 실시간 데이터 처리는 활성 slot에만 건다.
- 활성 로봇 전환 시 이전 subscription을 해제하고 새 로봇 데이터를 구독한다.
- 로봇 slot 목록은 세션 단위이며 구버전 localStorage slot 데이터는 제거한다.
- ROS 연결은 서버의 `/ws-proxy?target=IP:9090`을 통한다.
- proxy target은 사설/로컬 주소와 9000~9100 포트만 허용하며, handshake 제한과 50MB payload 제한이 있다.
- 자동 재연결 토글과 수동 Rescan을 제공한다.
- 네트워크 검색은 사용자가 지정한 `/24` 대역과 고정 주소 `192.168.3.5`를 확인하며 RID를 감지한다.
- 로봇 템플릿: Scorpion V1, Scorpion V2, Conveyor Bot, Custom Robot.

---

## 3. 전체 화면 정보 구조

### 3.1 고정 헤더

왼쪽부터 다음 정보를 갖는다.

1. 모바일 지도 토글
2. EasyLoop 로고
3. 활성 로봇 selector
4. 연결 요약 버튼과 popover
5. Work State 표시
6. BMS 게이지 버튼
7. 운전 모드 `MANUAL`/`AUTO`
8. 다중 로봇 빠른 전환 버튼
9. 미니관제 workspace 토글
10. Jog 아이콘 버튼
11. CMD 아이콘 버튼
12. 시각적으로 가장 강조된 `Quick Task`
13. Test Mode 버튼과 popover
14. 더보기 메뉴
15. Logout

연결 요약 popover:

- 연결 상태
- Robot ID, IP, model
- ROS latency
- Rescan
- Auto Reconnect
- Robot Settings

헤더 popover는 동시에 하나만 열고, 바깥 클릭과 Escape로 닫는다.

더보기 메뉴:

- Dark/Light theme
- 글자 크기 Small/Normal/Large/X-Large
- Initial Setup
- Alarm Settings
- Event Log
- Error Codes
- Health Check
- 증상 진단
- Incident Report
- Audit Trail
- Session Export
- Session Import

### 3.2 본문

- 왼쪽은 지속적으로 보이는 Map panel, 오른쪽은 tab workspace다.
- 지도는 축소·확장·전체화면이 가능하다.
- 화면 폭 980px 이하에서는 지도와 workspace를 세로로 쌓는다.
- `Fleet Mini Control`은 일반 tab bar 항목이 아니라 헤더에서 전환하는 별도 workspace다.

기본 tab 순서:

1. Dashboard
2. ROS Control
3. Tasks
4. Camera
5. Terminal
6. Batch
7. Files
8. Docking
9. Monitor
10. Scheduler
11. Diagnostics
12. Motor Diag/CAN

### 3.3 공통 피드백

- Toast: 오른쪽 아래, 최대 폭 약 360px, success/error/info/warning 의미 구분
- 버튼 로딩: 원래 레이블을 복원할 수 있는 spinner/disabled 상태
- Modal: 어두운 overlay 위 중앙 정렬, 긴 내용은 내부 scroll
- 상태 pill/badge: disconnected, connecting, connected, warning, error, Test Mode를 색뿐 아니라 텍스트로도 구분
- 빈 목록은 빈 화면으로 두지 말고 원인과 다음 행동을 표시
- Event와 Audit은 서로 다르다. Event는 사용자 작업·상태 피드, Audit은 중요 조작 기록이다.

### 3.4 로봇 설정 modal

연결 요약의 `Robot Settings`에서 연다.

자동 검색:

- IP 대역 입력, 기본 `192.168.20`, preset `192.168.20`/`192.168.3`
- 마지막 대역은 `easyloopScanSubnet`에 저장
- `로봇 스캔`
- Enter로도 검색
- ROS Bridge와 RID를 확인하는 진행 상태
- 검색 중, 0대, 발견, RID 미확인, 고정 주소, 이미 등록, 현재 수신 상태를 구분
- `192.168.3.5`는 입력 대역과 별도로 항상 확인
- 로그인 직후에도 background 자동 검색하고 발견 fleet을 session slot으로 구성
- 발견 robot을 선택하면 활성화

등록 robot 표:

- unit 번호
- IP
- Robot ID
- SSH port
- Tunnel ON/OFF와 `127.0.0.{unit}:9090`
- 수신/대기/연결 중/오프
- 연결/연결 해제
- 활성화
- 삭제
- Test Mode 임시 로봇은 삭제 대신 badge

수동 추가:

- template: ULW-100, ULW-200, ULW-300, SCOUT, CUSTOM
- IP
- robot 번호; 숫자는 `R_001` 형식으로 정규화
- SSH port, 기본 22
- Port Forward checkbox
- SSH password
- 수동 추가

설정 복사:

- source robot → target robot
- IP는 유지
- SSH port, tunnel mode, password, robot number를 복사

robot slot은 브라우저 session 동안만 유지한다. 연결 robot이 두 대 이상이면 header의 다중 로봇 빠른 전환 버튼을 보인다.

---

## 4. 지도·Mapping 화면

### 4.1 지도 상단

- `Map` 제목
- 전체화면
- 지도 panel 접기
- 네 개의 compact `<details>` 메뉴: `레이어`, `보기`, `위치 / 이동`, `Mapping`
- 현재 지도 정보
- 메뉴는 서로 배타적으로 열린다.

### 4.2 레이어

기본 ON:

- Map
- Robot

선택 레이어:

- LiDAR Merged: `/{robotId}/scan`
- LiDAR Front: `/{robotId}/scan_1`
- LiDAR Rear: `/{robotId}/scan_2`
- Footprint
- Local Costmap
- Navigation Path: `best_local_trajectories_nav`
- Current Goal: `WaypointsGlobalPlanner/current_goal`
- Dock Pose: `/{robotId}/dock_pose`
- Mapping Path: `lio_sam/mapping/path` + pose trail
- Map Correction

레이어 메뉴 summary에 활성 개수 badge를 표시한다. 선택은 `amrChk_*` localStorage에 보존한다.

표시 설정:

- Robot icon: `Simple(footprint)`, `AMR`, `Turtle`
- LiDAR color picker, 기본 `#ff3333`
- LiDAR point size 1~8, step 0.5, 기본 2.5

지도 데이터가 화면에서 잠시 가려져도 로봇 위치 overlay를 위해 map subscription은 유지한다.

### 4.3 보기

- Zoom In, Zoom Out, 100% reset
- 현재 zoom %
- 왼쪽 90°, 오른쪽 90°, 회전 초기화
- 지도 Auto Align
- 로봇 따라가기
- wheel zoom 범위 0.1~10
- 일반 drag는 pan, 우클릭 drag는 rotate

### 4.4 위치·이동

- 초기 위치
- COV 재배치
- 목적지 지정
- 수동 이동/Jog

초기 위치:

- 지도에서 위치를 누르고 drag하여 방향을 정한다.
- `/{robotId}/initialpose`에 publish한다.
- covariance는 x/y 0.25, yaw 0.07을 사용한다.

COV:

- `/{robotId}/cov_reposition`
- `std_srvs/Empty`

목적지 지정:

- 지도에서 위치와 방향을 정한 뒤 popup을 연다.
- X, Y, Yaw 확인
- 최대 속도 0.1~2.0m/s, 기본 0.8
- 목적지 통과 false/true
- 검은 점유 셀 회피는 안전상 ON 고정
- `주행 시작`, `취소`
- 실로봇에서는 `/move_base_simple/goal`에 PoseStamped를 publish한다. popup의 속도·통과 옵션은 이 message에 포함되지 않는다.
- Test Mode에서는 해당 옵션을 시뮬레이션에 반영한다.

### 4.5 Mapping

새 맵 생성:

- SLAM 시작/종료
- 시작 시 이전 SLAM path와 graph를 reset한다.

부분 Mapping:

- Lifelong 시작/종료
- 기존 맵과 graph를 유지하며 변경 영역을 갱신한다.

도구:

- 맵 편집
- LiDAR 정렬
- 맵 저장

상태:

- `꺼짐`, 실행 중, 저장 중, 오류 등
- `sp_routine`, `sp_routine_status`, `spx/operation_mode`, `spcore/MODE`와 연계
- routine 의미는 `SLAM`, `LIFELONG`, `NAV`
- Mapping 시작 시 Mapping Path 레이어를 자동 활성화

종료/저장 확인 modal:

- 고정 저장 경로 `~/ROS_DB/map/map.pgm` (기존 `map.*` 세트는 날짜별 백업)
- `취소`
- `아니오`: 저장하지 않고 종료
- `예`: 저장 후 종료
- 별도의 저장 전용 진입에서는 저장 의미만 수행

### 4.6 Loop Closure

- `/{robotId}/slam_toolbox/karto_graph_visualization`의 graph edge 증가를 Loop Closure 성립 신호로 사용한다.
- 단순 proximity 추정으로 성공을 선언하지 않는다.
- 대기 상태, edge 수, 성공 notice, `확인`을 제공한다.
- 새 SLAM은 graph를 reset하고 Lifelong은 유지한다.
- 반복 애니메이션은 `prefers-reduced-motion`에서 줄인다.

### 4.7 Map Correction

다음 두 형식을 수용한다.

- `/{robotId}/map_correction`, `syscon_msgs/Map_correction`
- `/{robotId}/lio_sam/mapping/map_correction`, `std_msgs/Float64MultiArray`

지속 badge로 level, percentage를 표시한다. level 의미:

- Perfect
- Good
- Warning
- Bad
- Hazard

### 4.8 지도 우클릭 메뉴와 POI

우클릭 위치에서:

- Navigate Here: yaw 0으로 즉시 목적지
- Set Pose Here
- Add POI: 이름 prompt 후 localStorage 저장
- Copy X/Y

저장 POI는 지도에 표시한다. POI 일괄 Import/Export/Clear 모달 코드는 있으나 현재 해당 버튼이 HTML에 없어 우클릭 Add만 사용자 진입이 가능하다.

### 4.9 맵 편집

도구:

- `[1]` Obstacle, black
- `[2]` Free, white
- `[3]` Unknown, gray
- `[4]` Scan Fill
- `[5]` Move/Pan
- `[Q]` circle/square brush 전환
- `[` / `]` brush 크기 조절
- Shift+Click 직선
- Space 또는 우클릭 Pan
- Ctrl+Z Undo
- Reset
- Save
- Cancel
- Maps/Backup
- 저장 후 Apply

입력:

- Brush size 1~30
- Raycast toggle
- Raycast mode: Draw+Clear, Draw Only, Clear Only
- Raycast range 1~30m, 기본 10
- Pose X/Y/Yaw 표시

저장:

- OccupancyGrid를 PGM/YAML로 만들어 SFTP로 로봇 map 경로에 저장한다.
- Apply는 `syscon_msgs/ChangeMap`을 사용한다.
- Backup modal에서 목록, PGM preview, restore, rename, delete를 제공한다.

### 4.10 No-Go Zone

지도 위에 panel HTML과 editor module이 존재한다.

- New, Delete, Clear All
- zone list
- Export, Import

단, 현재 `btn-nogo-edit` 진입 버튼이 없어 일반 UI에서는 열 수 없다. 리팩터링 중 임의 노출하지 않는다.

### 4.11 LiDAR Alignment

Mapping 메뉴의 `LiDAR 정렬`에서 wide modal을 연다.

- Start Scan
- Stop
- Check Alignment 버튼은 시작 후 `Reset` 의미로 바뀌어 30 sample history를 비운다.
- 상태 Off/Live
- Pitch/Height 편차 meter, mm
- Yaw/Angle 편차 meter, degree
- PASS/WARN/FAIL verdict
- 600×400 canvas
- scan_1 front red, scan_2 rear blue, overlap green
- wheel zoom 0.2~10
- drag pan

동작:

- `/{rid}/scan_1`, `/{rid}/scan_2`를 100ms throttle로 구독
- `/tf_static`에서 laser/scan frame의 base_link 상대 위치·yaw를 해석
- TF가 없으면 SR3 diagonal 기본 배치 사용
- 두 scan의 공통 1° bucket range를 비교
- 서로 500mm 이상 다른 point는 다른 표면으로 제외
- 공통 sample 5개 미만이면 판정하지 않음
- 최근 30개 rolling average
- Pitch PASS <3mm, WARN <8mm, 그 이상 FAIL
- Yaw PASS <0.3°, WARN <0.8°, 그 이상 FAIL
- modal close 시 scan과 TF subscription, render timer를 정리

이 도구는 정렬값을 로봇에 자동 기록하거나 보정하지 않고 측정·판정만 한다.

### 4.12 지도 기반 Task 표시

- Quick Task HUD
- action selection overlay
- 실행 중 Task panel
- route checkbox
- 간단/전체 요약 토글
- Task Info
- 완료 route green, pending cyan, active yellow
- 선택 action highlight
- mini detail window

---

## 5. Dashboard

### 5.1 Work State

- 현재 상태 값, 레이블, 색 bar
- Header와 Dashboard에 동시 반영
- 상태 코드:

| 코드 | 레이블 |
|---:|---|
| -1 | NOT RUNNING |
| 0 | IDLE |
| 1 | WORK |
| 2 | DOCK |
| 3 | PAUSE |
| 4 | CANCEL |
| 5 | ABORT |
| 7 | STAND BY |
| 8 | DOCK OUT |
| 9 | FOLLOW ME |
| 10 | MAPPING |

Colors panel에서 상태별 색을 선택·저장한다. 색 선택지는 Red, Orange, Yellow, Green, Blue, Indigo, Purple, Black, Gray, White다.

### 5.2 Timeline과 BMS Trend

- Work State Timeline: 최근 10분
- BMS Trend: 최근 10분
- metric selector: SOC, Voltage, Current
- BMS CSV export

BMS header gauge:

- SOC %, fill
- SOC 20% 이하는 low, 50% 이하는 medium, 그 이상 normal
- current > 0.1A이면 charging
- 클릭 시 detail modal

BMS detail modal:

- Voltage, Current, SOC, charging 상태
- 100%까지 예상 충전 시간
- 목표 SOC, 기본 80%, 까지 예상 시간
- 방전 중 사용 가능 시간
- raw data
- Ah/current 기반 즉시 추정과 최소 30초/10 sample history 기반 추정의 계산 중 상태
- Test Mode에서는 충전 상태 toggle 제공

### 5.3 Velocity Monitor

- Feed source: `odom`, `feed_vel`, `cmd_vel_out`, Custom topic
- Custom 기본 `/feed_vel`
- Start/Stop
- elapsed와 status
- X/Y/angular 3개 canvas
- command와 feedback 비교
- CSV export
- 종료 후 통계, error, delay report

### 5.4 Topic Hz

- BMS
- WorkState
- Pose
- Map
- LiDAR

매초 수신 counter를 Hz로 표시하고 정상/저하 의미를 색과 텍스트로 구분한다.

### 5.5 Integration Test

8개 항목을 순차 검사하고 progress bar, 단계, 결과를 표시한다.

1. ROS connection
2. BMS 수신, 2초
3. Work State 수신, 2초
4. Pose 수신, 2초
5. Map info
6. LiDAR 수신, 2초
7. Pose valid
8. SOC 10~100

결과는 HTML report로 저장한다.

### 5.6 Setup Checklist

즉시 검사:

1. ROS
2. BMS
3. Pose
4. Work State
5. Map
6. LiDAR
7. Pose valid

각 항목 pass/warn/fail과 summary를 표시한다.

### 5.7 Widget 설정

현재 사용자가 표시 여부를 바꿀 수 있는 항목은 아래 네 개뿐이다.

- Work State
- WS Timeline
- BMS Trend
- Topic Hz

Velocity Monitor, Integration Test, Setup Checklist는 `data-widget`가 있어도 현재 설정 목록에는 없다.

---

## 6. ROS Control

상단 도구:

- Refresh All
- Rosbag
- Params
- Perf

### 6.1 Favorites

- Node, Topic, Service, Param item을 double-click하면 pin/unpin한다.
- chip으로 표시하고 개별 제거 가능
- Clear Favorites
- localStorage `rosFavorites`

### 6.2 ROS browser

Nodes:

- search, count, refresh
- 선택 node kill
- double-click favorite

Topics:

- search, count, refresh
- 명령 selector: echo, info, hz, bw, type, show
- double-click favorite
- Message Type Browser에서 흔한 message type을 선택하고 `rosmsg show`

Services:

- search, count, refresh
- double-click은 service call 입력을 준비하거나 favorite 처리

Params:

- search, count, refresh
- double-click은 get 대상 준비 또는 favorite 처리

공통 결과는 mono `pre` panel에 보여준다.

### 6.3 Service Call과 Param Get/Set

- Service name
- JSON args
- Call
- Param name
- Get
- Set value

파싱 실패, ROS 미연결, service 오류를 결과 panel과 toast에 함께 표시한다.

### 6.4 Topic Subscribe

입력:

- topic name
- message type
- field filter
- throttle 1~100, 기본 10
- Subscribe/Unsubscribe/Clear/Aliases

quick presets:

- LiDAR: scan_1, scan_2
- Drive: robot_state, odom, amcl_pose, cmd_vel, feed_vel
- Docking: dock_pose, docking_state, docking/cmd_vel, sp_routine_status
- Power: bms, bms_node/battery_state, bms_node/bms_error

출력은 JSON dump만 쓰지 말고 알려진 message는 전문 renderer를 유지한다. Alias modal은 display name → 실제 topic mapping을 추가·삭제하고 localStorage에 저장한다.

### 6.5 rosout viewer

- level: All, Debug, Info, Warn, Error, Fatal
- text filter
- Start/Stop
- Clear
- 내부 최대 500 log, 화면에는 최신 100개
- time, level, node, message

### 6.6 Rosbag modal

Record:

- output path 기본 `~/ROS_DB/rosbag`
- optional filename
- comma-separated topics 또는 all
- duration 0은 수동 종료
- Start/Stop

Play:

- bag path
- rate 0.1~10
- loop
- Play
- Pause 버튼이 보이지만 현재 handler가 없다.
- Stop

Files:

- directory 조회
- 최근 `.bag` 20개
- Play, Info, Delete

명령은 SSH background `rosbag record/play`, 종료는 `pkill`을 사용한다.

### 6.7 Param Tuning

- 검색어 또는 namespace
- quick namespace: `/move_base`, `/amcl`, `/global_costmap`, `/pure_controller`
- SSH `rosparam list | grep`, 최대 30개
- 현재 값 표시
- bool은 select, 나머지는 input
- 항목별 Set
- 전체 Refresh Values
- 값 유형을 추론해 `rosparam set`

### 6.8 Performance Profiler

- ROS node별 CPU, memory 표
- Refresh
- Auto Refresh
- SSH process 조회를 사용

---

## 7. Tasks

Tasks는 EasyLoop의 핵심 workflow다. `Quick Task`, 저장 Task library, 상세 Action Builder, 실행 상태를 하나의 일관된 체계로 보여준다.

### 7.1 실행 상태

- 활성 로봇과 연결 상태
- 실행 feedback: idle/work/complete/pause/cancel/abort/recovery/error
- Task 이름/ID, 현재 action, 진행, message
- Info, Pause, Resume, Cancel
- 최근 실행 3개를 session snapshot으로 유지하고 현재 활성 로봇에 Replay
- 실행 중 route를 지도에 표시

실로봇 interface를 자동 탐지한다.

SPX:

- goal `/{rid}/spx/task/goal`
- pause `/{rid}/spx/task/pause`, `spx_task_msgs/TaskPause`
- resume `/{rid}/spx/task/resume`, `spx_task_msgs/TaskResume`
- cancel `/{rid}/spx/task/cancel`, `spx_task_msgs/TaskCancel`
- feedback `spx_task_msgs/TaskFeedback`

Legacy:

- goal `/{rid}/TARU/goal`
- pause `/{rid}/TARU/pause`, `sp_task/Int32_srv`
- resume `/{rid}/TARU/resume`, `sp_task/Int32_srv`
- cancel `/{rid}/TARU/cancel`, `sp_task/String_srv`
- feedback `sp_task/Feedback`

### 7.2 Task library

- YAML source selector: `__local__`과 import된 source file group
- Import YAML
- 현재 file Export YAML
- Search
- Refresh
- Quick Task
- New Task

Built-in Task panel:

- 접힘 상태 저장
- 수정 가능한 권장 profile
- Settings modal에서 args/params/common/loop 편집
- PC에 override 저장
- Reset Recommended
- Copy to User Tasks

기본 8개:

| 표시 이름 | action |
|---|---|
| 기본 - 도킹 | 0x08 |
| 기본 - 도킹아웃 | 0x10 |
| 기본 - WayPoint | 0x01 |
| 기본 - Standby | 0x07 |
| 기본 - TrajectoryFollowing | 0x15 |
| 기본 - 리프트 업 | 0x16 |
| 기본 - 리프트 다운 | 0x16 |
| 기본 - 컨베이어 구동 | 0x18 |

User Task card는 이름, action 수, source, 실행, 편집, 복사, 삭제, export 흐름을 제공한다. 저장 Task의 loop에서 0은 무한 반복이다.

### 7.3 Quick Task

입력:

- Task name
- task_id
- loop, 0은 무한

도구:

- WayPoint 연속 배치
- Trajectory 연속 point 배치와 Finish
- Docking
- DockingOut
- Standby
- Save
- Save & Run

단축키:

- `W` WayPoint
- `T` Trajectory
- `D` Docking
- `O` DockingOut
- `S` Standby
- `F` Trajectory Finish
- `Backspace` 마지막 항목 취소
- `Ctrl+Enter` 저장 후 실행
- `Esc` Quick Task mode 종료

Trajectory option:

- lane name
- max speed 기본 0.7
- lane type: Strict, Smooth 기본, Off
- direction: Forward, Backward

Docking wizard:

1. Charge
2. Direction
3. Scan type 1~7
4. End condition 1~3
5. 나머지 args/params를 권장값과 함께 순차 입력

Previous, Next, Cancel, Apply Remaining Defaults를 제공한다.

Standby duration 기본 5초, 0은 무한. DockingOut distance 기본 -1.

Live preview:

- compile된 action을 chip/목록으로 표시
- 지도 action 선택 highlight
- action 단위 delete
- delete undo
- reorder
- clear
- Save 후에도 바로 Run 가능

### 7.4 상세 Action Builder

공통 form:

- Action type
- Action name optional, 비면 자동 생성
- Arguments
- Parameters
- Common Parameters
- Add to Task
- Save Selected Action
- Apply Params to Selected Same Type
- Clear
- Undo/Redo, 최대 30 state

Queue:

- 순서 번호
- drag/reorder
- duplicate
- remove
- 선택하여 form에 load
- 이름 입력
- Save/Load/Delete Task
- loop
- task ID
- Execute/Cancel
- Result/Feedback

`Apply Params`는 같은 type의 선택 action에 parameter만 적용하고 좌표, 방향, action name은 보존한다. 편집 중 변경이 저장되지 않았으면 dirty 강조를 표시한다.

Action History:

- 접힌 `<details>`
- 최근 50개
- form으로 restore
- Clear

### 7.5 Action 전체 스키마

#### 0x01 Way_Point

- args: `x`, `y`, `theta`
- params: `max_trans_vel=0.7`, `max_rot_vel=0.6`, `xy_goal_tolerance=0.15`, `yaw_goal_tolerance=0.05`, `passing_flag=false`, `passing_dist=0.03`, `straight_path=false`, `avoid_mode=true`, `road_width=4`, `backward_driving=false`, `model_type=0`, `set_local_planner=0`, `motion_direction=0`
- `model_type`: DD=0, QD fixed heading=1, Trailer=2
- `set_local_planner`: Pure=0, TEB=1, MPC=2, DWA=3
- `motion_direction`: auto=0, forward=1, backward=2, crab=3, omni=4

#### 0x02 Basic_Move

- args: `move_type` (linear=0, rotation=1), `move_amount`; 직진 최대 10m, 회전 ±180°
- params: `move_vel=0.5`

#### 0x07 Stand_By

- args: `duration=5`; 0은 resume까지 무한
- optional ID와 공통 sound

#### 0x08 Docking

- args:
  - `is_charge`
  - direction: front=1, rear=-1, left=2, right=3
  - scan type: L=1, LV=2, Cradle=3, Rack CFG=4, ArUco=5, ML-LV=6, Direct=7
  - end condition: distance=1, IR=2, contact=3
- params: `dock_dist=1.2`, `dock_dist_flag`, `scan_view`, `x_offset`, `y_offset`, `center_offset`, `v_angle=90`, `mark_size=0.1`, `marker_type=1`, `target_id`, `target_size=0.1`, `cradle_width`, `cradle_depth`, `model_type`, `target_cfg`
- `target_cfg`는 로봇 model param을 확인하고 원격 cfg 목록을 제공한다.

#### 0x10 DockingOut

- arg: `distance=-1`
- params: `cradle_width`, `cradle_depth`, `x_offset`, `is_crab_motion`

#### 0x12 DockingOut_0x12

- JS schema는 존재하지만 action selector에는 노출되지 않는다. 임의 노출하지 않는다.

#### 0x15 Trajectory

- args: 최초 `x0`, `y0`, `theta`, 실제 queue에서는 가변 개수 point
- params: `lane_name=lane_tmp`, `driving_type=0..5`, `lane_direction=0/3`, `lane_type=0/1/2`, `max_trans_vel=1.8`, `max_rot_vel=1`, `xy_goal_tolerance=0.15`, `yaw_goal_tolerance=0.05`, `road_width=4`, `passing_flag=false`, `passing_dist=0.03`, `backward_driving=false`, `qr_correction_mode=true`, `sync_mode_enabled=false`, `using_basic_footprint=false`, `collision_detect_range=0.15`
- `driving_type`: Following=0, Overtake=1, StopAndGo=2, ObstacleAvoid=3, Carriageway=4, Bypass=5
- `lane_direction`: Forward=0, Backward=3
- `lane_type`: Strict=0, Smooth=1, Off=2

#### 0x16 Lift

- args: `mode=0..6`, `target`
- mode: Stop=0, Up=1, Down=2, Position=3, Height=4, Sensor Init=5, Error Reset=6
- `target`: mode 3은 position, mode 4는 mm height, 나머지는 0
- param: `lccs_loading_mode=false`

#### 0x17 Change_Map

- args: `init_x`, `init_y`, `init_theta`
- param: `map_id`

#### 0x18 Conveyor

- args: `cmd_type`, `floor` 1/2, 기본 1
- `cmd_type`: Reset=0x01, Stop=0x02, FrontLoad=0x03, FrontUnload=0x04, RearLoad=0x05, RearUnload=0x06
- 실행 시 floor에 맞는 conveyor command pair로 확장
- conveyor가 하나인 로봇에서는 floor 2를 차단

#### 0x19 Quad

- args: `target_x`, `target_y`
- params: `heading_yaw=0`, `rotate_first=true`

#### 0x21 Forklift

- args: `mode`, `value`
- mode: Lift=1, Shift=2, Positioning=3, Tilt=4
- value 범위: Lift 0~2990, Shift 0~100, Positioning 400~1000, Tilt 0 down/2 up
- param: `request_vision_update=false`

#### 0x22 Turntable

- args: `mode`, `target`
- mode: Stop=0, CCW90=1, CW90=2, Target=3, SlowCCW=4, SlowCW=5, Nearest=6, KIVA=11~16, Reset=20~21
- `target`은 mode 3/13에서 degree

모든 action의 Common Parameters:

- `common/sound_trigger`
- `common/footprint`
- `common/obstacle_enabled`
- `common/rgbd_obstacle_enabled`
- `common/fake_localization_enabled`

### 7.6 YAML

- ROS/RViz 계열 Task 구조를 parse/serialize한다.
- 한 파일에 여러 Task를 유지한다.
- 원본 source file grouping과 선택 상태를 보존한다.
- UI 리팩터링으로 key 이름, action code, loop 의미, 좌표 순서를 바꾸지 않는다.

---

## 8. Camera

- source checkbox 네 개: Cam1 Depth, Cam1 Color, Cam2 Depth, Cam2 Color
- 기본 선택: Cam1 Color, Cam2 Color
- layout 1~4, 기본 2
- 선택 수는 pane 수를 넘지 않게 조정
- 1~4개 canvas
- pane label
- Snap All: 현재 표시 camera를 PNG로 저장
- color는 compressed, depth는 raw Image를 처리
- 미수신, decode 중, 연결 끊김 상태를 canvas overlay로 표현

---

## 9. Terminal, CMD, Batch, Files

### 9.1 Terminal

- 활성 로봇 대상
- username 기본 `syscon`
- password optional
- Connect/Disconnect/status
- xterm dark console
- 최대 4개 terminal tab
- `+`로 추가
- 마지막 terminal은 닫을 수 없음
- 검색 bar: Ctrl+F, 이전, 다음, count, close, Escape
- terminal resize를 서버 PTY에 전달
- 비밀번호 필요 응답이면 별도 password modal
- Test Mode에서는 가상 Linux 응답

### 9.2 CMD floating panel

헤더에서 열고 drag 가능한 panel이다.

Preset:

| 이름 | 동작 |
|---|---|
| Scorpion Restart | stop, stop, start 순차 실행 |
| Check ROS Status | `rostopic list \| head -20` |
| System Info | hostname, uptime, memory, CPU |
| Disk Usage | `df -h` |
| Network Info | `ip addr show` 요약 |
| Reboot Robot | 확인 후 `sudo reboot` |

Camera Serial:

- `rs-fw-update -l` 실제 camera serial 조회
- `~/scorpion.sh`의 `CAM_1_SERIAL`, `CAM_2_SERIAL` 비교
- match/mismatch/not configured/no device 표시
- mismatch면 실제 serial 적용
- 적용 확인 후 Scorpion 재시작 여부 확인

Command Snippets:

- 이름 + 명령 추가
- chip/list
- 클릭 실행
- 삭제 확인
- localStorage `amrCmdSnippets`

모든 결과는 mono output에 stdout/stderr/step을 구분해 표시한다.

### 9.3 Batch

- 한 줄에 한 명령
- 빈 줄과 `#` 주석 무시
- Run All
- Abort
- 활성 로봇 한 대에서 순차 실행
- 명령 사이 500ms
- output에 `[현재/전체] $ command`, stdout/error 표시
- Abort는 현재 SSH 명령을 강제 kill하지 않고 다음 명령 전에 중단한다.

### 9.4 Files

- 활성 로봇의 SSH session과 결합
- remote path 기본 `/home`
- Browse
- parent directory
- folder click 이동
- table: Name, Size, Modified, Actions
- file Download
- file picker Upload
- drag & drop Upload
- progress 표시
- 최대 download 100MB
- Diff modal로 두 파일 비교
- 로봇 전환 시 이전 로봇 session을 잘못 재사용하지 않도록 session을 rebind

File Diff:

- File A Original path
- File B Modified path
- 각 파일 `Load from Robot`; SSH `cat`으로 textarea에 읽기
- path 대신 두 textarea에 직접 paste 가능
- Compare
- Clear
- line 단위 sequential diff
- added, removed, unchanged count
- 추가/삭제/동일 line을 서로 다른 색과 prefix로 표시
- 이 기능은 파일을 수정하지 않는다.

---

## 10. Docking Test

### 10.1 기본 시험

- Test Type: Timer 또는 Precision
- Docking type
- repeat 1~100, 기본 10
- args: charge, direction, docking type, end sign
- Start/Stop/Export CSV
- cycle 진행
- dock-in, dock-out time
- avg/max/min/3 sigma
- result log

Docking type과 동적 parameter:

| Type | Parameters |
|---|---|
| L_dock | dock_dist 0.2, dock_dist_flag |
| LV_dock | dock_dist, dock_dist_flag, v_angle 120, marker_type 1 |
| Cradle_dock | dock_dist, flag, x/y offset, cradle width 0.5, depth 0.3 |
| Rack_dock | dock_dist, flag, scan_view 60, center_offset |
| Aruco_dock | dock_dist, flag, target ID 1/2, target_size 0.1, marker_size 0.05, quad_flag |
| ML_LV_dock | dock_dist, flag, scan_view 90, v_angle 120, marker_type 1 |

### 10.2 OptiTrack

- Server IP
- Scan: `/optitrack/get_server_info`, 실패 시 topic과 param 탐색
- Connect/Disconnect
- `SetBool` server service 시도 후 직접 subscribe fallback
- rigid body selector
- reference body selector
- Set Reference
- XYZ, RPY
- 기준 대비 x/y/yaw/distance precision
- 개별 PoseStamped topic과 RigidBodyArray/PoseArray를 모두 수용
- 설정 localStorage

### 10.3 Precision graph

- recording toggle
- max points 50~2000, 기본 500
- scale 10~200mm, 기본 50
- Clear
- Snapshot
- Test
- XY cluster canvas
- yaw time-series canvas
- mean과 3 sigma

---

## 11. Monitor와 Fleet Mini Control

### 11.1 Monitor

현재 로봇 slot마다 card를 만든다.

- Robot ID
- IP
- connected/disconnected
- Work State
- BMS와 charging icon
- Pose X/Y/Yaw

card 클릭 시 해당 로봇을 활성화하고 Dashboard로 이동한다. 현재 UI에는 CPU/Memory/Disk resource card가 없다.

### 11.2 Fleet Mini Control

헤더에서 별도 workspace로 전환한다.

상단:

- 포함할 연결 로봇 checkbox/queue
- 공통 map
- map fingerprint
- 로봇별 map 불일치 warning
- task route 표시
- task label 표시
- robot icon size 24~72, 기본 40
- Refresh Map

지도:

- 여러 로봇 icon, label, 상태, 데이터 age
- 선택 로봇 강조
- 클릭하여 task 대상 선택
- 각 로봇의 실행 route 표시

사이드:

- 선택 로봇 card
- Task 검색
- 저장 Task list
- Task preview/detail
- loop 0~9999
- Run/Cancel
- 진행 결과

단축키:

- 저장 Task 이름 정렬 순서 기준 Ctrl+1~9
- 선택 로봇과 Task action preview를 확인 modal에 표시
- Enter 실행
- Escape 취소
- Fleet workspace가 활성일 때 Ctrl+1~9가 일반 tab 전환보다 우선한다.

---

## 12. Scheduler

Header의 운전 모드:

- MANUAL → AUTO: 비밀번호 `0000` 확인
- AUTO → MANUAL: 비밀번호 없음

Mission:

- Add Mission은 저장 Task를 고르고 이름을 입력
- mode:
  - Once
  - Interval
  - Daily/cron `HH:MM`
  - Battery threshold
- enable/disable
- Run Now
- Delete
- Clear All

동작:

- 자동 timer는 AUTO mode에서만 실행
- 수동 Run Now는 MANUAL에서도 가능
- interval과 daily schedule
- battery는 10초 polling, 실행 후 5분 cooldown
- 현재 Once는 자동 실행 timer가 없어 Run Now로만 실행
- log 최대 100개 저장, 최근 20개 표시
- Clear Log

---

## 13. Diagnostics·Alarm·Report

### 13.1 Diagnostics tab

Boot Check:

- Nodes, Topics, TF Tree, Services, State Values, System Resources
- category별 pass/warn/fail
- 전체 0~100 score

expected nodes:

- P0: `spcore`, `robotstate_pub`, `TARU`, `odom_pub`
- P1: `amcl_node`, `move_base`, `navigation_manager`, `route_planner`
- P2: `sp2_lidar`, `twist_smoother`, `map_server`

topic 기준:

- P0: robot_state ≥10Hz, emergency, motor_status ≥10Hz, taru_state
- P1: amcl_pose ≥1Hz, odom ≥10Hz, cmd_vel, move_base/status ≥1Hz
- P2: scan ≥5Hz, tf ≥10Hz

기타:

- TF map→base, odom
- service: make_plan, clear_costmaps, global_localization, request_nomotion_update
- state: Work State, BMS, bridge
- CPU/MEM/DISK/TEMP warn: 80/80/85/70
- fail: 95/95/95/80
- category weight: nodes20, topics25, TF15, services10, state15, system15
- score ≥90 Healthy, ≥70 Warning, 미만 Critical

30s Monitor:

- 1초 Hz sample
- 5초 CPU/MEM sample
- rosout errors
- emergency
- static_stop
- node survival
- Hz CV >0.3 warning, >0.5 fail
- progress, Stop

### 13.2 Health Check

더보기 modal에서 한 번에 순차 실행한다.

| Check | 기준 |
|---|---|
| ROS Master | 활성 slot ROS connected |
| ROS Bridge | 활성 slot ROS connected |
| CPU | 80% 이하 pass |
| Memory | 85% 이하 pass |
| Disk `/` | 90% 이하 pass |
| CPU Temperature | 75°C 이하 pass |
| Network | robot IP의 9090 HEAD, 3초 |
| System Time | 값 수신 |
| Uptime | 값 수신 |
| ROS Nodes | 5개 이상 pass |

- Pending → checking → pass/warn/fail
- Run 중 button disabled
- 완료 시 pass/fail 개수 toast
- CPU/Memory/Disk/Temp/Time/Uptime/Node 수는 SSH 명령으로 읽는다.
- 현재 구현은 `/api/ssh/exec`에 `host/user/password/command`를 직접 보내지만 backend는 `sessionId/command`를 요구하므로 SSH 항목이 실패할 수 있다. UI 리팩터링에서 완료된 정상 동작으로 과장하지 않는다.

### 13.3 증상 진단

진단 tree를 따라 증상을 선택하고 다음 질문/권장 점검으로 이동한다. breadcrumb, Back, Restart를 제공하고 최종 권장 조치를 표시한다. 자동 수리 기능으로 표현하지 않는다.

분기:

- Robot not moving
  - Yes, but no motion → motor/drive, emergency, cable, Jog 점검
  - No commands received → communication
  - Error state active → Work State, error code, last action, system log
- Navigation failure
  - Localization lost
  - Cannot find path
  - Obstacle detected
  - Goal unreachable
- Communication issues
  - ROS topic missing
  - Network connection
  - WebSocket disconnect
- Sensor problems
  - LiDAR
  - Camera
  - IMU
  - Encoders
- Battery/Charging
  - Not charging
  - Fast drain
  - BMS error

각 leaf는 `Checks to perform`와 `Possible solutions` 목록을 보여준다.

### 13.4 Error Codes

- 코드 검색
- category/filter
- 설명과 권장 조치
- 사용자 custom code 추가·저장
- localStorage `amrErrorCodesCustom`

### 13.5 Smart Alarm

기본 Alarm:

- BMS SOC Low Battery: 기본 ON, 20% 이하
- Work State Error: 기본 ON, `99,100`
- Topic Drop: 기본 ON, 5초 동안 BMS/Work State/Pose 무수신
- Alarm Sound: 기본 OFF
- 2초마다 평가
- alarm 시 error toast, Event Log, optional 880Hz beep, header flash

Smart Alarm Rule:

- enabled
- rule name
- metric: CPU, Memory, Disk, CPU Temp, Battery SOC, Work State
- operator: `>`, `>=`, `<`, `<=`, `=`, `!=`
- number threshold
- action: Toast, Sound, Log
- Add/Delete
- 새 rule 기본: CPU >80, Toast+Log
- 5초마다 평가
- 조건이 계속 참인 동안 한 번만 trigger하고 false가 된 뒤 재무장
- localStorage `amrSmartAlarmRules`

CPU/Memory/Disk/Temp 값은 현재 비노출 `SysInfo` DOM을 읽으므로 해당 DOM이 없으면 0 또는 미평가가 될 수 있다. 브라우저 notification action은 Smart Rule form에는 없다.

### 13.6 Event Log

오른쪽 side panel:

- All, Info, Success, Warning, Error filter
- Clear
- Close
- 최신 100개 render
- 저장 최대 200개
- 7일 초과 정리

### 13.7 Audit Trail

- 중요 조작의 시간, action, detail
- 최대 500개 저장
- 검색과 action filter
- 화면은 최대 200개
- CSV Export
- Clear
- Session Export/Import 대상에는 포함되지 않음

### 13.8 Incident Report

동적 modal:

- incident type
- 설명
- 포함 checkbox:
  - Robot Status
  - Recent Events
  - System Info
  - ROS Info
  - Audit Trail 최근 50
  - Screenshot
- Generate Preview
- Markdown download
- 생성 audit 기록

System Info module이 실제로 실행되지 않은 경우 “데이터 없음”을 허용한다.

### 13.9 Error Code 기본 범위

| Code | Name |
|---:|---|
| 99 | SYSTEM_ERROR |
| 100 | EMERGENCY_STOP |
| 101 | NAV_GOAL_REJECTED |
| 102 | NAV_PLANNING_FAILED |
| 103 | NAV_LOCALIZATION_LOST |
| 104 | NAV_OBSTACLE_BLOCKED |
| 201 | MOTOR_OVERCURRENT |
| 202 | MOTOR_OVERHEAT |
| 203 | ENCODER_ERROR |
| 204 | DRIVER_FAULT |
| 301 | BMS_LOW_VOLTAGE |
| 302 | BMS_OVERCURRENT |
| 303 | BMS_OVERHEAT |
| 304 | BMS_COMM_ERROR |
| 401 | LIDAR_ERROR |
| 402 | CAMERA_ERROR |
| 403 | IMU_ERROR |
| 404 | ULTRASONIC_ERROR |
| 501 | ROS_MASTER_LOST |
| 502 | ROSBRIDGE_TIMEOUT |
| 503 | CAN_BUS_ERROR |
| 601 | DOCK_NOT_FOUND |
| 602 | DOCK_ALIGNMENT_FAIL |
| 603 | CHARGING_CONTACT_FAIL |

code, name, description, solution을 표시하고 code/name/description 검색을 지원한다. custom code는 prompt로 숫자/name/description/solution을 받아 추가하며 custom 항목만 삭제할 수 있다.

---

## 14. Motor Diagnostics / CAN

엔지니어 전용이다.

### 14.1 화면 구조

- Robot schematic
- node click detail
- CAN summary와 interface
- table: Node, 역할, status, error, STO, current, position
- log/output
- action toolbar

기본 node:

| Node | 역할 |
|---:|---|
| 1 | FL Drive |
| 2 | FR Drive |
| 3 | RL Drive |
| 4 | RR Drive |
| 5 | Front Steer |
| 6 | Rear Steer |
| 7 | Lift |

### 14.2 기능

- Scan
- Parameter read
- 다른 두 IP parameter Compare
- Duplicate ID Check
- STO
- ID Change
- Fault Reset
- Drive Test
- Bus-off Check
- Bus-off Recover

Drive Test:

- node 1~4
- speed 0.05~0.5m/s
- UI duration 1~30초
- safety checkbox 필수
- backend는 현재 10초까지 허용하므로 10초 초과 요청은 실패할 수 있다.

보호:

- Steering 5/6은 parameter write, drive, STO 해제 대상에서 보호
- Lift 7도 parameter/drive 보호
- Lift STO는 경고 후 가능

Syntron 핵심 register:

| Register | 의미 |
|---|---|
| Fn000 | Protocol, 3=CANopen |
| Fn003 | Mode, 2=Speed |
| Fn006 | Motor code, 0x0D1E=3358 |
| Fn010 | SON, 2=CANopen |
| Fn035 | STO, 0x0000=ON 안전 정지, 0x55AA=OFF 구동 허용 |
| Fn0F3 | Baudrate |
| Fn0F4 | Node ID |
| Fn0FD | Phase voltage check |

backend CAN endpoint:

- `/api/can/scan`
- `/api/can/sdo-read`
- `/api/can/sdo-write`
- `/api/can/params`
- `/api/can/compare`
- `/api/can/setup`
- `/api/can/id-change`
- `/api/can/drive-test`
- `/api/can/fault-reset`
- `/api/can/sto`
- `/api/can/busoff-check`
- `/api/can/busoff-recover`
- `/api/can/dup-check`
- `/api/can/enable`
- `/api/can/can-status`

현재 소스의 알려진 결선 불일치:

- frontend parameter read는 `/api/can/params/read`를 호출하지만 backend는 `/api/can/params`
- frontend compare는 `/api/can/params/compare`를 호출하지만 backend는 `/api/can/compare`
- frontend는 일부 경로에서 `App.showToast`를 호출하지만 실제 공통 함수는 `App.toast`
- active robot IP 조회도 `App.currentRobot` fallback 때문에 실패할 수 있음
- Bus-off recover bitrate는 backend에서 500000으로 설정하지만 UI fallback 표시는 250K일 수 있음

이 차이는 UI 리팩터링 범위에서 조용히 수정하거나 숨기지 말고 별도 결함으로 기록한다.

---

## 15. Jog Control

헤더, 지도, 단축키 `J`에서 여는 drag 가능한 floating panel이다.

### 15.1 Chassis profile

로봇별 선택을 localStorage에 저장한다.

- `default_lift_dd`: 기본 DD + lift
- `sr3_ls_1st`: DD, lift UI 대신 door/conveyor

Drive model:

- DD
- QD
- profile에 따라 자동 선택되고 selector가 disabled될 수 있음

topic suffix 기본 `/cmd_vel`, Robot ID namespace를 붙인다.

### 15.2 속도와 주행

- linear 0.05~1.0m/s, step 0.05, 기본 0.2
- angular 0.1~2.0rad/s, step 0.1, 기본 0.5
- hold button과 keydown 동안 100ms 간격 publish
- pointerup, pointercancel, blur, visibilitychange, robot switch에서 zero publish

DD:

- W/↑ forward
- X/↓ backward
- A/D rotate left/right

QD:

- W/X forward/backward
- A/D strafe
- Q/E rotate

공통:

- S/Space stop
- `+`/`-` linear speed
- Ctrl+`+`/`-` angular speed

### 15.3 Reset·Lift·Charge

- Motor Reset: `/{rid}/motor_reset`, `std_srvs/Trigger`
- Lift Reset: `/{rid}/Lift/motor_reset`, `std_srvs/Trigger`
- Lift manual: `/{rid}/Lift/manual_cmd`, Int8 +1/-1/0, 75ms
- Z/C lift up/down

Charge:

- ON은 확인
- OFF는 즉시
- service 후보를 탐색:
  - `/{rid}/io/set/auto_charge_relay`
  - `/io/set/auto_charge`
  - `/SUBCON_/charge_relay_cmd`
  - `/device_manager/charge_relay_cmd`
  - `/io/set/charge_relay`
  - `/io/charge_relay`
- `std_srvs/SetBool`
- relay feedback topic과 BMS current를 함께 표시
- ON 후 8초 동안 충전 전류가 없으면 오류
- O/F charge ON/OFF

### 15.4 SR3 door/conveyor profile

`/{rid}/Conv/cmd`, `syscon_msgs/conv_cmd`

- Front Door Open: cmd 144, count 1
- Front Door Close: 145
- Rear Door Open: 146
- Rear Door Close: 147
- Front Intake: 3, count 0
- Rear Discharge: 6
- Stop: 2

### 15.5 Quick slots

- 5개 고정 slot
- slot 이름
- 저장 Task 선택
- 활성 로봇에서 loop 1로 실행
- 현재 대상과 결과 표시

---

## 16. Test Mode

### 16.1 시작과 종료

Header popover:

- robot count 1~3, 기본 3
- drive model:
  - DD: 모든 Action을 DD로 강제
  - QD: 모든 Action을 QD로 강제
  - Action 설정: 각 Action의 `model_type`을 사용하며 Trailer도 가능
- 상태
- Start/Stop

시작 시:

- 공유 비밀번호 재확인
- 로컬 ROS master, rosbridge, rosapi를 필요하면 실행
- loading overlay에 단계, progress, Cancel, watchdog 표시
- 실제 fleet 상태를 보존하고 가상 `R_TEST_*` fleet으로 교체

종료 시:

- 가상 publisher/process 정리
- 이전 실제 fleet 복원

### 16.2 시뮬레이션 범위

- BMS, charging
- Robot State, Work State
- Pose, TF, odom
- map, scan, footprint
- camera
- Mapping path/graph/Loop Closure
- SLAM/Lifelong/Nav routine
- Quick Task와 상세 Task
- Pause/Resume/Cancel
- action loop
- Jog DD/QD kinematics
- Docking Test
- map save 후 NAV

Navigation:

- occupancy map 기반 A*
- occupied cell 목표 거부
- 장애물 inflation
- DD는 차체 방향 회전, QD는 heading 유지 가능
- WayPoint speed/tolerance/passing/straight/avoid/road width/planner/collision 설정 반영
- Trajectory lane type/direction/driving 반영

Mapping:

- 가상 LiDAR로 occupancy를 생성
- pose trail, footprint, graph
- Mapping 실행이 일반 navigation보다 우선
- Test Mapping status overlay와 demo 시작 버튼
- `순환주행` demo는 SLAM/Lifelong 실행 중이고 기존 Task가 없을 때 현재 pose 주변 1.2m 사각 경로와 원점 복귀, 총 5개 WayPoint를 loop 1회로 실행한다.

Test Mode는 단순 mock badge가 아니라 전체 workflow 검증 수단이다. UI 리팩터링 후에도 실제와 같은 빈 상태, 로딩, 진행, 완료, 실패 화면을 시험할 수 있어야 한다.

---

## 17. Initial Setup

더보기 메뉴에서 여는 독립 modal이다. 이 기능은 원격 로봇 설정을 실제 변경하므로 일반 조회 modal처럼 보이면 안 된다.

연결:

- 기본 IP `192.168.3.5`
- SSH port 22
- user `syscon`
- password optional
- Connect/Disconnect

연결 후 자동 감지:

- PC Manufacturer
- Ubuntu
- ROS distro
- LAN Cards
- Hostname

### 17.1 Network

Load Current 후 form을 활성화한다.

필수:

- Robot ID/ROS_HOSTNAME
- LAN card
- IP
- subnet, 기본 255.255.255.0

선택:

- gateway
- DNS, 공백 구분
- ROBOT_MODEL
- PLC_IP

Apply:

- Ubuntu 18.04+는 `/etc/netplan/01-scorpion-config.yaml`
- Ubuntu 16.04는 `/etc/network/interfaces`
- 기존 파일 timestamp backup
- `.bashrc`, `~/scorpion.sh`의 ROS_MASTER_URI, ROS_HOSTNAME, ROBOT_MODEL, PLC_IP 갱신
- `/etc/hosts` backup 후 robot/PLC entry 갱신
- `~/ROS_DB/network/config`에 설정 저장

적용 전 대상 host, 새 IP, interface, 변경 파일을 요약하고 재연결 필요성을 경고한다.

### 17.2 `.bashrc Env Vars`

- Load
- `export KEY=VALUE` 목록
- 기존 값 편집
- Add/Delete
- Save
- `/home/{user}/.bashrc.bak.{timestamp}` backup

### 17.3 `/etc/hosts`

- Load
- textarea editor
- Save
- sudo backup

---

## 18. 사용 팁 시스템

`usage-guides.js`는 다음 정적 영역에 `📝 사용 팁` trigger를 붙인다.

- 각 `.tab-content`
- Map
- Jog
- CMD
- Event Log
- DOMContentLoaded 시 이미 존재하는 modal

공유 note modal:

- 영역별 소개
- 빠른 순서
- Tips
- 해당 화면 단축키
- 접을 수 있는 전역 단축키
- 특정 guide가 없으면 fallback 안내

나중에 동적으로 생성된 modal은 현재 자동 부착 대상이 아니다. UI 리팩터링 시 trigger가 header control을 밀어내거나 canvas를 가리지 않게 배치한다.

---

## 19. 전역 단축키

입력창에 포커스가 있을 때 일반 문자 단축키는 실행하지 않는다. Ctrl/Meta 조합만 예외다.

| 키 | 동작 |
|---|---|
| 숫자 연속 입력 | Robot unit 번호 buffer, 예: 1→R_001 |
| Backspace / Enter | unit buffer 수정 / 즉시 확정 |
| Ctrl+1~9 | 현재 보이는 tab 전환 |
| Fleet에서 Ctrl+1~9 | Task 확인 modal |
| Fleet modal Enter/Escape | 실행/취소 |
| Ctrl+K | ROS tab Topics search focus |
| Ctrl+M | Map panel toggle |
| G | Nav Goal mode |
| P | Set Pose mode |
| J | Jog toggle |
| F | fullscreen |
| W/X/A/D/Q/E | Jog |
| S/Space | 즉시 정지 |
| Z/C | Lift up/down |
| O/F | Charge ON/OFF; Jog context와 충돌 규칙 유지 |
| + / - | linear speed |
| Ctrl + / - | angular speed |
| Ctrl+Z | Action/Map edit context Undo |
| Ctrl+Y, Ctrl+Shift+Z | Redo |
| Ctrl+F | Terminal search |
| Enter | 활성 Action tab에서 전송 또는 검색 next |
| Escape | modal, overlay, Jog, CMD, context menu 닫기 |
| ? | shortcut help |

Quick Task와 Map Edit의 context 단축키는 해당 mode일 때 우선한다.

---

## 20. 현재 시각 디자인 시스템

### 20.1 정체성

- 기본은 GitHub dark 계열의 차분하고 밀도 높은 산업용 콘솔
- 작은 radius, 얇은 border, 절제된 shadow
- 위험 빨강, 경고 amber, 성공 초록, 선택·연결 파랑
- 카드와 panel은 배경 단계와 border로 구분
- terminal/code/path/topic/service는 monospace
- 장식보다 상태 식별과 조작 속도를 우선

### 20.2 실제 token

```css
--bg-base: #0d1117;
--bg-surface: #161b22;
--bg-elevated: #21262d;
--bg-inset: #0d1117;
--border-default: #30363d;
--border-subtle: #21262d;
--text-primary: #e6edf3;
--text-secondary: #8b949e;
--text-muted: #6e7681;
--accent: #58a6ff;
--accent-hover: #79c0ff;
--accent-subtle: rgba(56, 139, 253, 0.1);
--success: #3fb950;
--danger: #f85149;
--warning: #d29922;
--info: #58a6ff;
--radius-sm: 4px;
--radius-md: 6px;
--radius-lg: 8px;
```

기본 font:

```css
-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif
```

- 기본 14px, line-height 1.5
- HTML이 Sora Google Font를 load하지만 body는 현재 system font를 사용한다.
- terminal: Menlo, Monaco, Courier New, monospace, 14px
- font mode: Small 12px, Normal 14px, Large 16px, X-Large 18px
- Large/X-Large에서는 button padding과 label 크기도 증가

### 20.3 Light mode

- `body.light-mode`
- base `#f4f5f7`, white surface, gray border
- primary accent `#2563eb`
- 모든 핵심 panel, modal, input, table, map control, usage guide, CAN 화면에 명시적 light override가 필요
- theme은 `amrFieldToolTheme`에 저장

### 20.4 Component 형태

Buttons:

- default neutral
- primary blue
- danger red
- small/mini
- icon/ghost
- active는 배경, border, text를 함께 바꿈
- disabled는 opacity만 낮추지 말고 이유를 title/status로 제공

Cards:

- surface/elevated 배경
- 1px border
- 6~8px radius
- compact header + actions
- 상태 stripe/dot/badge

Forms:

- label과 unit 분리
- number min/max/step 유지
- technical identifier는 줄임표 + title
- JSON/YAML/command는 mono
- validation error는 입력 근처와 toast에 표시

Tables:

- sticky/명확한 header
- 긴 path는 가로 scroll 또는 ellipsis
- 선택 row, hover, destructive action을 구분

Popovers:

- header와 map toolbar에 anchor
- viewport 밖으로 나가지 않음
- 하나만 열림
- Escape/outside click

Floating panel:

- Jog와 CMD
- drag handle이 분명
- viewport 안에 유지
- mobile에서는 drag보다 full-width sheet 형태

### 20.5 특수 표현

- Quick Task launch는 헤더에서 파란 gradient로 가장 눈에 띈다.
- Built-in Task는 별도의 light-blue 계열 panel로 사용자 Task와 구분한다.
- action dirty는 pulse와 border를 사용하되 색만으로 의미를 전달하지 않는다.
- BMS charging/calculating, reconnect, recording, alarm, spinner, loop closure에 animation이 있다.
- `prefers-reduced-motion`을 존중한다.
- 사용 팁 modal은 노트지 느낌의 amber accent를 사용한다.
- 지도 canvas는 어두운 배경과 선명한 occupancy/route/lidar contrast를 유지한다.

---

## 21. 반응형·접근성

현재 CSS는 누적된 여러 breakpoint가 있으므로 리팩터링 시 최종 cascade를 명시적으로 정리하되 동작은 유지한다.

viewport token:

```css
--easyloop-viewport-height: 100vh; /* 100dvh 지원 시 100dvh */
--easyloop-edge-gap: clamp(6px, 1vw, 16px);
--easyloop-panel-gap: clamp(6px, 0.8vw, 12px);
```

주요 breakpoint:

- 1600/1601
- 1480: header 두 줄
- 1200/1180: compact controls
- 980: 지도와 workspace 세로 배치
- 900
- 760
- 620: mobile
- 600
- 480
- max-height 760/700
- coarse pointer

620px 이하:

- Quick Task를 header의 full-width 첫 행으로 둘 수 있음
- logo, Work State 장문, Test Mode 장문 label 축약
- header control은 가로 scroll
- map popover는 viewport 상단에 고정형으로 배치
- form/grid는 한 열
- modal과 Jog/CMD는 거의 full width
- table은 가로 scroll
- active Task panel은 full width
- touch target 최소 36px
- checkbox 약 18px

접근성:

- `aria-live` toast 유지
- modal은 dialog/aria-modal, 제목 연결, focus 이동과 복귀
- icon-only button은 aria-label/title
- 색 외에 text/icon/shape 사용
- focus-visible outline
- keyboard로 모든 menu와 form 접근
- canvas에는 상태 summary와 대체 텍스트 영역 제공
- 위험 confirm에서 기본 focus를 파괴 동작에 두지 않는다.
- 동적 상태가 갱신되어도 사용자의 현재 focus와 scroll을 빼앗지 않는다.

---

## 22. ROS 실시간 데이터 계약

주요 subscription:

- `/{rid}/bms`, `std_msgs/Float32MultiArray`: V, A, SOC
- `/{rid}/robot_state`, `syscon_msgs/RobotState`
- `/tf`, `/tf_static`
- `/{rid}/amcl_pose`
- `/{rid}/odom`
- `/{rid}/sp_routine_status`
- `/{rid}/spx/operation_mode`
- `/{rid}/spcore/MODE`
- `/{rid}/slam_toolbox/karto_graph_visualization`
- `/{rid}/dock_pose`
- Map Correction 두 variant
- charge relay feedback variant
- camera depth/color
- map
- `scan`, `scan_1`, `scan_2`
- footprint
- local costmap
- navigation path/current goal
- mapping path

Pose:

- NAV에서는 RobotState pose 우선
- direct map→base TF 또는 map→odom + odom→base 조합
- 조합 transform timestamp 차가 1초를 넘으면 사용하지 않음
- namespace가 붙은 frame도 정규화

Footprint fallback:

1. footprint topic
2. `/{rid}/move_base/local_costmap/footprint` param
3. RobotState radius

throttle:

- 일반 150ms
- pose/LiDAR/color fast 50ms
- depth 200ms

UI 리팩터링이 subscription을 중복 생성하거나 active robot 전환 후 이전 데이터가 섞이게 해서는 안 된다.

---

## 23. Backend 계약

### 23.1 API

Auth:

- POST `/api/auth/login`
- POST `/api/auth/logout`
- GET `/api/auth/status`

Robots:

- GET `/api/robots`
- GET `/api/robots/scan`
- POST `/api/robots`
- DELETE `/api/robots/:id`
- GET `/api/robots/scan-subnet`
- GET `/api/robots/templates`

SSH:

- POST `/api/ssh/connect`
- POST `/api/ssh/exec`
- POST `/api/ssh/exec-sequence`
- POST `/api/ssh/disconnect`

SFTP:

- POST `/api/sftp/list`
- POST `/api/sftp/download`
- POST `/api/sftp/upload`

Tunnel:

- POST `/api/tunnel/start`
- POST `/api/tunnel/stop`
- POST `/api/tunnel/stop-all`
- GET `/api/tunnel/status/:tunnelId`
- GET `/api/tunnel/list`

Test Mode:

- POST `/api/testmode/start`
- POST `/api/testmode/stop`

기타:

- GET `/api/download`: 앱 zip 다운로드, `.env`, `.git`, `node_modules` 등 제외
- command route는 IP+route 기준 분당 60회 제한

WebSocket:

- `/ws-proxy`: ROS
- 기본 WebSocket: interactive SSH terminal

### 23.2 SSH와 터널

- SSH key를 우선 사용할 수 있고 password가 주어지면 password를 사용
- connect timeout 10초
- command 최대 길이 8192
- sequence 최대 200 step
- 총 wait 최대 600000ms
- 터널 local bind: `127.0.0.{robotNumber}:9090`
- remote: `127.0.0.1:9090`

---

## 24. 저장 상태

UI 리팩터링 후 기존 사용자의 설정을 잃지 않는다.

주요 localStorage:

- `amrFieldToolTheme`
- `amrFontSize`
- `amrActiveTab`
- `easyloopScanSubnet`
- `amrChk_*`
- `workStateColorMap`
- `rosFavorites`
- Action Task queue/library/source selection/history
- built-in Task override와 panel open state
- Quick Task config
- topic alias mapping
- POI
- Jog chassis/drive profile와 5 quick slot
- `amrCmdSnippets`
- Scheduler missions/log/mode
- `optitrackSettings`
- `amrSmartAlarmRules`
- `amrErrorCodesCustom`
- Event Log
- Audit Log
- `fleetRobotIconSize`
- theme/font/widget visibility

소스에서 직접 사용하는 정확한 key:

| Key | 용도 |
|---|---|
| `amrFieldToolTheme`, `amrFontSize`, `amrActiveTab`, `amrLanguage` | 화면; language는 항상 ko |
| `amrChk_*` | Map layer별 선택 |
| `easyloopScanSubnet` | 검색 대역 |
| `rosFavorites`, `amrTopicMapping` | ROS pin과 alias |
| `actionSenderLastParams` | 마지막 Action form |
| `actionSenderSavedQueues` | 저장 Task |
| `actionSenderTaskFileSelection` | 선택 YAML source |
| `actionHistory` | Action 실행 history |
| `jogQuickTasks`, `jogChassisModelByRobot` | Jog quick slot과 chassis |
| `easyloopTestDriveModel` | Test Mode DD/QD/Action 설정 |
| `amrCmdHistory`, `amrCmdSnippets` | command history와 snippet |
| `dockingTestParams`, `optitrackSettings` | Docking/OptiTrack |
| `mapPOIs` | POI |
| `alarmSettings`, `amrSmartAlarmRules` | 기본/Smart Alarm |
| `amrErrorCodesCustom` | custom error |
| `amrEventLog`, `amrAuditTrail` | Event/Audit |
| `widgetConfig`, `amrBreadcrumb` | widget/diagnostic breadcrumb 설정 |
| `opMode` | MANUAL/AUTO |
| `missionScheduler`, `missionSchedulerLog` | Scheduler |
| `fleetRobotIconSize` | Fleet map icon |
| `amrMapVersions`, `amrNoGoZones` | 현재 비노출 module 데이터 |
| `amrRobotSlots` | 구버전 key; 시작 시 제거 |

Session Export/Import가 실제로 허용하는 key는 아래와 같다.

```text
actionFavorites
paramPresets
actionSenderSavedQueues
actionSenderLastParams
jogQuickTasks
alarmSettings
widgetConfig
workStateColorConfig
amrTheme
lastConnectionIp
lastConnectionRobotId
amrFieldToolTheme
amrDarkMap
amrFontSize
amrTouchMode
amrActiveTab
amrSmartAlarmRules
amrErrorCodesCustom
amrQuickNotes
amrCommandSnippets
amrCommandHistory
amrRosFavorites
```

이 whitelist 밖의 key는 import하지 않는다. 파일명은 `amr-session_{timestamp}.json`이고 import 후 refresh가 필요하다고 안내한다. 일부 현재 모듈의 실제 저장 key와 위 legacy whitelist 이름이 다르므로 모든 설정이 export된다고 표현하지 않는다. Event Log와 Audit Trail도 Session Export 대상이 아니며 Audit은 자체 CSV Export를 사용한다.

---

## 25. 현재 비노출·부분 구현 기능

다음 module은 script로 load되지만 현재 HTML에 진입 버튼 또는 필수 표시 element가 없다. 리팩터링 명세에 “현재 사용자 기능”으로 섞지 않는다.

| Module/기능 | 현재 상태 |
|---|---|
| `sysinfo.js` | resource 표시 DOM이 없어 독립 화면 비노출 |
| `map-file-manager.js` | `btn-map-manager` 없음 |
| `network-config.js` | `btn-network-config` 없음; Initial Setup Network는 별도 활성 구현 |
| `no-go-zone-editor.js` | panel은 있으나 `btn-nogo-edit` 없음 |
| `map-version-control.js` | `btn-map-version` 없음 |
| `fleet-dashboard.js` | `btn-fleet-dashboard` 없음; Fleet Mini Control은 활성 |
| `robot-comparison.js` | compare/propagate 버튼 없음 |
| POI bulk manager | 동적 modal 코드는 있으나 `btn-poi-*` 없음 |
| `floating-widget` | HTML은 hidden, 열기 control 없음 |
| Action 0x12 | schema만 있고 selector 비노출 |
| Rosbag Pause | 버튼은 있으나 click handler 없음 |

활성이나 현재 결함이 확인된 기능:

- CAN parameter/compare endpoint mismatch와 `App.showToast` 호출
- CAN active robot lookup fallback
- CAN Drive Test UI 30초 vs backend 10초
- Scheduler Once 자동 timer 없음
- Monitor의 “System Resources” 주석과 달리 실제 resource UI 없음
- 언어 파일이 여러 개 존재할 수 있으나 현재 `i18n.js`는 한국어만 강제하며 language switch가 없다.
- `health-check.js`와 `sysinfo.js`의 SSH 요청 body는 현재 backend의 session 기반 `/api/ssh/exec` 계약과 맞지 않는다.
- `sysinfo.js`는 `sysinfo-*` DOM이 존재한다고 가정하지만 현재 화면에는 없고, `IncidentReport`가 기대하는 `_lastData`도 설정하지 않는다.

이 항목은 누락 방지와 범위 통제를 위한 것이다. 별도 제품 결정 없이 활성화·수정·삭제하지 않는다.

### 25.1 프런트 모듈 전수 목록

아래 38개 파일이 모두 `<script>`로 load된다. 리팩터링 후 script load 순서와 전역 의존성을 확인한다.

활성 핵심:

| 파일 | 담당 |
|---|---|
| `i18n.js` | 한국어 locale 적용 |
| `app.js` | 인증 후 전역 UI, header, robot slots, tabs, event/audit, alarm, shortcuts |
| `dashboard.js` | Dashboard 초기화 |
| `ros-manager.js` | ROS 연결, subscription, map/camera/BMS/pose/Mapping 렌더링 |
| `test-mode.js` | 가상 fleet과 시뮬레이션 |
| `ros-info.js` | Node/Topic/Service/Param browser |
| `map-context-menu.js` | 지도 우클릭 메뉴 |
| `ssh-terminal.js` | interactive terminal과 REST command session |
| `file-transfer.js` | SFTP |
| `commands.js` | CMD preset, serial, snippets, Batch |
| `action-sender.js` | Task library, Quick Task, Action Builder, 실행 feedback |
| `jog-control.js` | Jog, lift, charge, chassis profile |
| `vel-monitor.js` | Velocity Monitor |
| `docking-test.js` | Docking/OptiTrack/precision |
| `init-setup.js` | 초기 네트워크와 파일 설정 |
| `smart-alarm.js` | 사용자 rule |
| `rosout-viewer.js` | `/rosout` |
| `error-codes.js` | Error Code DB |
| `health-check.js` | One-click Health Check |
| `rosbag-control.js` | rosbag record/play/file |
| `incident-report.js` | Markdown incident report |
| `file-diff.js` | 두 파일 line diff |
| `param-tuning.js` | ROS parameter 검색·설정 |
| `diagnostic-tree.js` | 증상 decision tree |
| `performance-profiler.js` | node CPU/MEM |
| `diagnostics.js` | Boot Check와 30s Monitor |
| `lidar-align.js` | scan_1/scan_2 정렬 측정 |
| `can-robot-view.js` | CAN robot schematic |
| `can-diagnostics.js` | CAN 조작 UI |
| `fleet-control.js` | Fleet Mini Control |
| `usage-guides.js` | 화면별 사용 팁 |

현재 비노출 또는 진입 불완전:

| 파일 | 상태 |
|---|---|
| `sysinfo.js` | 표시 DOM 없음 |
| `map-file-manager.js` | open button 없음 |
| `network-config.js` | open button 없음 |
| `no-go-zone-editor.js` | open button 없음 |
| `map-version-control.js` | open button 없음 |
| `fleet-dashboard.js` | open button 없음 |
| `robot-comparison.js` | open buttons 없음 |

---

## 26. 리팩터링 산출물 요구

리팩터링 제안을 먼저 다음 순서로 작성한다.

1. 현재 정보 구조를 유지한 새 화면 구조
2. Desktop, tablet, mobile wireframe
3. component inventory와 상태 variant
4. color/type/spacing/radius/elevation/motion token
5. 핵심 workflow:
   - 로그인 → 로봇 검색·연결
   - Mapping 시작 → Loop Closure → 맵 편집 → 저장·적용
   - Quick Task 작성 → 지도 preview → 실행 → Pause/Resume/Cancel
   - Jog → 즉시 정지
   - Fleet Mini Control → 로봇 선택 → Task 확인·실행
   - Diagnostics → 원인 확인 → Incident Report
   - Initial Setup의 고위험 적용
6. 권한, 연결, 빈 상태, 로딩, 오류, Test Mode matrix
7. 기존 DOM/JS 계약을 보존하는 단계적 구현 계획

실제 코드 변경 시:

- 먼저 semantic HTML과 token을 정리한다.
- 한 번에 기능 모듈을 재작성하지 않는다.
- 공통 button/input/modal/table/badge/toast를 통합하되 기존 handler를 보존한다.
- CSS cascade와 중복 breakpoint를 정리한다.
- 각 단계에서 desktop/mobile, user/engineer, real disconnected/Test Mode를 모두 확인한다.

---

## 27. 완료 검수 체크리스트

### 전역

- [ ] user/engineer 역할별 tab 노출이 동일하다.
- [ ] Header의 로봇, 연결, Work State, BMS, mode, Quick Task, Test Mode, more, logout이 유지된다.
- [ ] 모든 popover가 outside click/Escape로 닫힌다.
- [ ] theme과 4단계 font size가 저장된다.
- [ ] Event, Audit, Toast, Loading, Empty, Error 상태가 구분된다.
- [ ] 한국어 고정과 ROS/command 원문이 유지된다.

### Map

- [ ] 모든 layer와 표시 설정이 있다.
- [ ] zoom/rotate/reset/auto-align/follow가 있다.
- [ ] pose, COV, nav goal, Jog가 있다.
- [ ] SLAM, Lifelong, Map Edit, LiDAR Align, Save가 있다.
- [ ] Loop Closure가 graph edge 기반이다.
- [ ] Map Correction과 Dock Pose가 표시된다.
- [ ] context menu와 POI가 동작한다.
- [ ] map edit tool, brush, raycast, undo, backup, apply가 있다.
- [ ] Quick Task와 실행 route가 지도에 표시된다.

### Dashboard·ROS

- [ ] Work State, timeline, BMS trend/detail, Hz가 있다.
- [ ] Velocity Monitor, Integration Test, Checklist가 있다.
- [ ] Node/Topic/Service/Param browser와 Favorites가 있다.
- [ ] Service call, Param get/set, Topic Subscribe, rosout이 있다.
- [ ] Rosbag, Param Tuning, Performance Profiler가 있다.

### Task

- [ ] built-in 8개와 user Task가 구분된다.
- [ ] YAML import/export/source grouping이 유지된다.
- [ ] Quick Task 연속 WayPoint/Trajectory와 Dock wizard가 있다.
- [ ] 12개 노출 action type과 전체 field가 유지된다. 0x12만 비노출이다.
- [ ] queue reorder/duplicate/edit/delete/undo/redo가 있다.
- [ ] history와 recent run이 있다.
- [ ] SPX/Legacy interface와 Pause/Resume/Cancel이 유지된다.

### 원격 도구

- [ ] Camera 4 source/layout/snapshot이 있다.
- [ ] xterm 4개, search, password fallback이 있다.
- [ ] CMD preset, camera serial, snippets가 있다.
- [ ] Batch 순차 실행과 Abort 의미가 같다.
- [ ] SFTP browse/upload/download/diff와 100MB 제한이 있다.

### 현장 시험·진단

- [ ] Docking type 6개, repeat, stats, CSV가 있다.
- [ ] OptiTrack 탐색·연결·reference·precision graph가 있다.
- [ ] Monitor card와 Fleet Mini Control이 있다.
- [ ] Scheduler mode/password/schedule/log가 있다.
- [ ] Boot Check와 30s Monitor 기준이 같다.
- [ ] Alarm, Error Codes, 증상 진단, Health Check, Incident Report가 있다.
- [ ] CAN node 1~7, STO/ID/drive/bus-off 안전 UX가 있다.
- [ ] Initial Setup의 Network/.bashrc/hosts와 backup 경고가 있다.

### Jog·Test Mode

- [ ] DD/QD 조작과 hold-to-run, release stop이 유지된다.
- [ ] Motor/Lift reset, Lift manual, Charge feedback이 있다.
- [ ] SR3 door/conveyor profile이 있다.
- [ ] 5개 Quick slot이 있다.
- [ ] Test Mode 1~3대, DD/QD/Action 설정, start progress, restore가 있다.
- [ ] Mapping/Nav/Task/Jog/BMS/Camera/Docking simulation이 유지된다.

### 반응형·접근성

- [ ] 980px 이하 지도 stack이 정상이다.
- [ ] 620px 이하 header, modal, floating panel, table이 사용 가능하다.
- [ ] coarse pointer target이 충분하다.
- [ ] keyboard shortcut과 focus가 유지된다.
- [ ] 색만으로 상태를 표현하지 않는다.
- [ ] reduced motion을 존중한다.

### 회귀 확인

- [ ] source에 없는 기능을 추가하지 않았다.
- [ ] 비노출 module을 임의 활성화하지 않았다.
- [ ] 알려진 부분 구현을 완료된 기능처럼 표현하지 않았다.
- [ ] 기존 localStorage 설정과 YAML을 그대로 읽는다.
- [ ] active robot 전환 후 이전 데이터나 SSH session이 섞이지 않는다.
- [ ] ROS subscription이 중복되지 않는다.
- [ ] 물리 동작의 확인·정지·실패 피드백을 보존했다.

---

## 28. 최종 지시

이 제품을 단순한 카드형 SaaS 대시보드로 축소하지 마라. EasyLoop의 핵심 가치는 한 명의 현장 엔지니어가 **로봇을 선택하고, 현재 상태를 확신하고, 지도 위에서 Mapping과 Task를 만들고, 필요할 때 저수준 ROS·SSH·CAN까지 내려갈 수 있는 연속성**이다.

시각적 정돈은 기능 밀도를 숨기는 것이 아니라 우선순위와 progressive disclosure로 다루어라. 항상 다음 세 질문에 즉시 답할 수 있는 화면을 만든다.

1. 지금 어떤 로봇을 보고 있는가?
2. 그 로봇은 연결·운전·충전·Task 관점에서 어떤 상태인가?
3. 지금 누르는 버튼이 어느 로봇에 어떤 실제 동작을 일으키는가?

위 명세와 검수 체크리스트를 모두 만족한 뒤에만 리팩터링 완료로 판단한다.
