# EasyLoop - 개발 이력

> AMR 현장 엔지니어용 웹 기반 모니터링 및 제어 도구
> 프로젝트 시작: 2026-01-13

---

## [2026-05-06] - Windows 실행 안정화 및 로봇 전환 UX 개선
### 기능 추가
- **호기 번호 직접 전환 확장**: 숫자 단축키가 등록 순서가 아니라 호기 번호 기준으로 동작하도록 변경
- **다자리 호기 입력 지원**: `10`, `44`, `101` 같은 2자리/3자리 호기를 숫자 연속 입력 후 자동 확정 또는 `Enter` 로 호출 가능하도록 개선
- **Windows 래퍼 실행파일 추가**: 단일 `pkg` 실행파일 대신 안정적인 폴더형 패키지를 실행하는 Windows 래퍼용 `EXE` 추가 (`windows-wrapper.js`)
- **빠른 토픽 토글 추가**: `scan_1`, `scan_2`, `robot_state`, `odom`, `amcl_pose`, `cmd_vel`, `feed_vel`, `dock_pose`, `docking_state`, `docking/cmd_vel`, `sp_routine_status`, `bms`, `battery_state`, `bms_error` 를 활성 로봇 기준으로 즉시 구독/해제 가능한 Quick Monitor UI 추가
- **도킹 액션 파라미터 보강**: `Docking(0x08)` 액션 입력 UI에 `target_cfg` 파라미터 추가

### 버그 수정
- **로봇 관리 창 미오픈 문제 수정**: `public/js/ros-manager.js` 의 중복 `const newSlot` 선언 제거로 초기화 중단 문제 해결
- **Windows EXE 실행 불안정 완화**: 메인 `EXE` 가 바탕화면 `EasyLoop` 폴더 패키지를 실행하도록 구조 조정
- **브라우저 자동 열기 개선**: `launcher.js` 의 Windows 브라우저 실행 명령 보정

### 개선사항
- **로봇 목록 정렬 규칙 개선**: 연결된 로봇 우선, 동일 상태에서는 낮은 호기 우선으로 상단 선택기/로봇 관리/모니터링 카드 정렬
- **호기 단축키 UX 개선**: `1~9` 단일 숫자 외에도 다자리 호기 번호 입력을 버퍼링해서 호출하도록 개선
- **한국어 표시 보강**: 로봇 관리, 연결 상태, 네트워크 스캔, 토스트 메시지 등 주요 UI 문구 한국어화
- **배포본 동기화**: 바탕화면 Windows 폴더형 패키지와 메인 `EXE` 에 최신 `app.js`, `ros-manager.js`, `index.html` 반영
- **실운영 소스 대조**: `192.168.20.51` 의 `~/catkin_ws/src` 기준으로 도킹 액션 파라미터 누락 여부 재검토

---

## [2026-02-15] - QA 감사 및 개선안 수립
### 기능 추가
- QA 감사를 통한 59개 개선 사항 발견 및 문서화

### 버그 수정
- 없음 (발견된 버그는 개선안에 기록됨)

### 개선사항
- **안정성**: CRITICAL 버그 5건, HIGH 버그 6건, MEDIUM 버그 5건 식별
- **보안**: CRITICAL 보안 이슈 2건, HIGH 보안 이슈 3건, MEDIUM 보안 이슈 2건 식별
- **성능**: 캔버스 렌더링, LiDAR 포인트 최적화 등 6개 성능 개선 사항 식별
- **UX**: 로딩 스피너, 확인 다이얼로그 등 10개 UX 개선 사항 제안
- 4단계 우선순위 로드맵 수립 (긴급 수정 → 안정성 → UX 개선 → 고급 기능)

---

## [2026-02-14] - ROS 매니저 안정화
### 기능 추가
- 없음

### 버그 수정
- ROS Bridge 연결 안정성 개선

### 개선사항
- ros-manager.js 최적화 (149KB, 4000+ 라인)
- WebSocket 재연결 로직 개선
- 메모리 누수 방지를 위한 이벤트 리스너 정리 강화

---

## [2026-02-09] - 초기 설정 및 UI 개선
### 기능 추가
- **초기 설정 마법사**: 처음 사용자를 위한 단계별 설정 가이드 (Init Setup)
- Setup Wizard UI 강화

### 버그 수정
- 없음

### 개선사항
- index.html 메인 UI 레이아웃 개선
- 사용자 온보딩 경험 향상
- 초기 로봇 연결 프로세스 단순화

---

## [2026-02-08] - 대규모 기능 확장 (Phase 2)
### 기능 추가
- **파일 차이 비교**: 로봇의 설정 파일과 기준 파일 간 차이점 시각화 (File Diff Viewer)
- **지도 파일 관리자**: 지도 파일 미리보기, 업로드, 전환 기능 (Map File Manager)
- **지도 버전 관리**: 지도 파일의 버전 관리 및 롤백 기능 (Map Version Control)
- **네트워크 설정 도구**: 로봇의 IP/서브넷/게이트웨이/DNS GUI 설정 (Network Config Tool)
- **파라미터 튜닝**: ROS 파라미터 실시간 조정 및 저장 (Parameter Tuning)
- **성능 프로파일러**: 노드별 CPU/메모리 사용량 프로파일링 (Performance Profiler)
- **로봇 비교**: 두 로봇의 설정/상태 나란히 비교 (Robot Comparison)
- **Rosbag 제어**: rosbag record/play 원격 시작/중지 (Rosbag Control)
- **인시던트 리포트**: 문제 발생 시 현재 상태 스냅샷 + 로그 자동 생성 (Incident Report)
- **지도 컨텍스트 메뉴**: 지도 위 우클릭으로 Navigate, Set Pose, Add POI 등 (Map Context Menu)
- **테스트 모드**: 단계별 기능 테스트 및 검증 모드 (Test Mode)

### 버그 수정
- server.js 안정성 개선
- SSH 터널 관리 안정화

### 개선사항
- 서버 측 터널 매니저 개선 (tunnel-manager.js)
- app.js 핵심 로직 최적화 (98KB)
- 전체적인 UI 반응성 향상

---

## [2026-02-05] - 대규모 기능 확장 (Phase 1)
### 기능 추가
- **다국어 지원**: 한국어, 영어, 일본어, 중국어 지원 (i18n)
- **Fleet 대시보드**: 여러 로봇의 상태를 한 화면에 요약 표시 (Fleet Dashboard)
- **금지 구역 편집기**: 지도 위에서 직접 No-Go Zone 그리기 (No-Go Zone Editor)
- **대시보드**: 최근 작업, 테스트 히스토리, 알림 통합 뷰 (Dashboard)
- **진단 트리**: 문제 증상 선택 시 자동 진단 체크리스트 (Diagnostic Tree)
- **액션 전송기**: ROS Action 전송 및 결과 확인 강화 (Action Sender)
- **파일 전송**: 드래그앤드롭 업로드, 진행률 표시 (File Transfer)
- **SSH 터미널**: 다중 터미널, 명령어 히스토리, 검색 기능 (SSH Terminal)
- **ROS 정보**: 노드, 토픽, 서비스, 파라미터 조회 (ROS Info)
- **헬스 체크**: 원클릭 전체 시스템 점검 (Health Check Suite)
- **명령어 스니펫**: 자주 사용하는 명령어 저장 및 빠른 실행 (Commands)
- **에러 코드 DB**: 에러 코드 입력 시 원인/해결 방법 안내 (Error Codes)
- **Rosout 뷰어**: ROS 로그 실시간 스트리밍 및 필터링 (Rosout Viewer)
- **스마트 알람**: 복합 조건 알람 규칙 설정 (Smart Alarm)
- **시스템 정보**: CPU/메모리/디스크/네트워크 모니터링 (SysInfo)
- **도킹 테스트**: OptiTrack 포함 도킹 시스템 테스트 (Docking Test)
- **조그 제어**: 로봇 수동 조작 제어 (Jog Control)

### 버그 수정
- 없음

### 개선사항
- **기능 구현 진행 현황 문서 작성**: 50개 핵심 기능 추적 문서 생성 (IMPLEMENTATION_PROGRESS.md)
- 로컬라이제이션 파일 구조 정리 (en.json, ko.json, ja.json, zh.json)
- 백업 시스템 구축 (backup/i18n.js)

---

## [2026-02-04] - 다국어 지원 및 터널 관리
### 기능 추가
- **로봇 템플릿**: 로봇 모델별 사전 설정 템플릿 (ULW-100, ULW-200 등)
- **SSH 터널 관리**: ROS Bridge 접속을 위한 SSH 터널 자동 관리

### 버그 수정
- 없음

### 개선사항
- 다국어 리소스 파일 구조 확립
- 서버 측 터널 라우트 추가 (server/routes/tunnel.js)
- 조그 컨트롤 UI/UX 개선

---

## [2026-01-31] - 아이디어 정리 및 로봇 관리 강화
### 기능 추가
- **로봇 자동 발견**: 같은 서브넷의 AMR 자동 스캔 및 선택 UI (Auto-Discovery)
- **로봇 템플릿 시스템**: 로봇 모델별 사전 정의된 설정 템플릿

### 버그 수정
- 없음

### 개선사항
- **아이디어 문서 생성**: 현장 엔지니어 관점의 100가지 개선 아이디어 정리 (IDEAS_100.md)
  - 카테고리 A: 사용자 경험 (18개)
  - 카테고리 B: 모니터링 기능 (22개)
  - 카테고리 C: IPC 세팅 (20개)
  - 카테고리 D: 현장 세팅 자동화 (20개)
  - 카테고리 E: 진단/디버깅 (8개)
  - 카테고리 F: Fleet 관리 (6개)
  - 카테고리 G: 안정성/보안/인프라 (6개)
- TOP 10 우선순위 기능 선정
- 서버 측 로봇 관리 라우트 개선 (server/routes/robots.js)

---

## [2026-01-30] - 초기 프로젝트 구조 확립
### 기능 추가
- **인증 시스템**: 공유 비밀번호 기반 인증 (Auth)
- **레이트 리미팅**: API 호출 속도 제한 (Rate Limit)
- **입력 검증**: 서버 측 데이터 검증 (Validation)
- **SSH 클라이언트**: 원격 SSH 연결 및 명령 실행 (SSH)
- **SFTP**: 파일 업로드/다운로드 기능 (SFTP)
- **로봇 설정 관리**: 로봇 연결 정보 저장 및 관리

### 버그 수정
- 없음

### 개선사항
- 프로젝트 기본 구조 설정
- package.json 의존성 정의
- Jest 테스트 환경 구성
- README.md 작성
- 서버 모듈 구조 확립:
  - server/auth.js - 인증 미들웨어
  - server/rate-limit.js - 레이트 리미팅
  - server/validation.js - 입력 검증
  - server/ssh.js - SSH 연결 관리
  - server/robots-config.js - 로봇 설정 관리
  - server/routes/auth.js - 인증 라우트
  - server/routes/ssh.js - SSH 라우트
  - server/routes/sftp.js - 파일 전송 라우트
- validation.test.js 테스트 코드 작성

---

## [2026-01-13] - 프로젝트 시작
### 기능 추가
- 프로젝트 초기화

### 버그 수정
- 없음

### 개선사항
- npm 프로젝트 생성
- 기본 의존성 설치 (package-lock.json 생성)
- 로봇 설정 파일 구조 생성 (config/robots.json)

---

## 주요 기술 스택
- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Backend**: Node.js, Express.js
- **ROS Integration**: rosbridge_suite (WebSocket)
- **SSH/SFTP**: ssh2 라이브러리
- **WebSocket**: ws 라이브러리
- **파일 업로드**: multer
- **테스트**: Jest
- **코드 품질**: ESLint

---

## 구현된 핵심 기능 요약 (2026-02-15 기준)

### 모니터링 & 제어
- ✅ ROS 노드/토픽/서비스/파라미터 조회
- ✅ 실시간 데이터 시각화 (BMS, Work State, 센서 데이터)
- ✅ 지도 기반 네비게이션 및 POI 관리
- ✅ 로봇 수동 조작 (조그 제어)
- ✅ 액션 전송 및 결과 추적

### 진단 & 디버깅
- ✅ 원클릭 헬스 체크
- ✅ 자동 진단 트리
- ✅ Rosout 로그 뷰어
- ✅ 성능 프로파일러
- ✅ 에러 코드 데이터베이스

### 파일 & 설정 관리
- ✅ SSH 터미널 (다중 세션)
- ✅ 파일 업로드/다운로드 (드래그앤드롭)
- ✅ 파일 차이 비교
- ✅ 설정 백업/복원
- ✅ 파라미터 실시간 튜닝

### Fleet 관리
- ✅ Fleet 대시보드
- ✅ 로봇 비교
- ✅ 설정 일괄 복사

### 고급 기능
- ✅ 다국어 지원 (한/영/일/중)
- ✅ 다크/라이트 테마
- ✅ 스마트 알람 규칙
- ✅ 인시던트 리포트 생성
- ✅ 테스트 모드
- ✅ 초기 설정 마법사

---

## 향후 계획 (QA 감사 기반)

### Phase 1: 긴급 수정 (1주)
- SFTP 업로드 실패 시 파일 삭제 버그 수정
- SSH exec 타임아웃 구현
- roscore 프로세스 정리 로직 수정
- TestMode 파라미터 전달 버그 수정
- SFTP 대용로드 메모리 최적화
- SSH 비밀번호 암호화 저장
- tunnel-manager 명령 인젝션 방지

### Phase 2: 안정성 (2주)
- 이벤트 리스너 누수 방지
- 타이머 정리 로직 강화
- Race condition 해결
- WebSocket 에러 핸들링 개선
- 인증 시스템 강화

### Phase 3: UX 개선 (3-4주)
- 로딩 스피너 추가
- 파괴적 작업 확인 다이얼로그
- 연결 품질 표시기
- 대시보드 위젯 접기/펴기
- 알림 센터

### Phase 4: 고급 기능 (4-8주)
- 모바일/태블릿 최적화
- PWA 오프라인 모드
- 다중 사용자 인증
- 자동화 규칙
- 데이터 CSV 내보내기

---

## 통계

- **총 개발 기간**: 33일 (2026-01-13 ~ 2026-02-15)
- **JavaScript 파일**: 44개 (public: 31개, server: 11개, tests: 1개, config: 1개)
- **총 코드 라인**: 약 20,000+ 라인
- **구현된 IDEAS_100 기능**: 47개 / 100개
- **식별된 개선 사항**: 59개 (버그 16개, 보안 7개, 성능 6개, UX 10개, 기타 20개)

---

## 기여자
- 현장 엔지니어 피드백 기반 설계
- Claude AI 어시스턴트 협업 개발

---

## 라이선스
MIT License
