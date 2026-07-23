# EasyLoop - QA Test Cases (100% Coverage)

**작성일**: 2026-02-15
**대상**: EasyLoop (`easyloop` 저장소)
**총 TC 수**: 573건
**커버리지**: 100%

---

## 목차

| 섹션 | 카테고리 | TC 수 |
|------|----------|-------|
| 1 | 인증 & 세션 | 20 |
| 2 | 로봇 관리 | 40 |
| 3 | SSH / 터미널 | 46 |
| 4 | 파일 전송 (SFTP) | 42 |
| 5 | 터널링 | 20 |
| 6 | 테스트 모드 | 24 |
| 7 | ROS 통합 | 39 |
| 8 | UI 컴포넌트 & 인터랙션 | 118 |
| 9 | 고급 기능 | 120 |
| 10 | 데이터 저장 | 13 |
| 11 | 다국어 (i18n) | 7 |
| 12 | 에러 처리 & 경계값 | 26 |
| 13 | 보안 | 15 |
| 14 | 성능 | 14 |
| 15 | 접근성 | 14 |
| 16 | 브라우저 호환성 | 10 |
| 17 | Rate Limiting | 5 |
| **합계** | | **573** |

---

## SECTION 1: 인증 & 세션 (20건)

### 1.1 로그인

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-AUTH-001 | 올바른 비밀번호 로그인 | 서버 실행, SHARED_PASSWORD 설정 | 1. 페이지 접속 2. 비밀번호 입력 3. Sign In 클릭 | 로그인 성공, 메인 화면 표시 | CRITICAL |
| TC-AUTH-002 | 잘못된 비밀번호 로그인 | 서버 실행 | 1. 페이지 접속 2. 잘못된 비밀번호 입력 3. Sign In 클릭 | "Invalid password" 에러 표시 | CRITICAL |
| TC-AUTH-003 | 빈 비밀번호 로그인 | 서버 실행 | 1. 페이지 접속 2. 비밀번호 미입력 3. Sign In 클릭 | 로그인 차단, 에러 메시지 | HIGH |
| TC-AUTH-004 | 비밀번호 최대길이(10자) | 서버 실행 | 1. 11자 이상 입력 시도 | maxlength=10으로 입력 제한 | MEDIUM |
| TC-AUTH-005 | Enter 키로 로그인 | 서버 실행 | 1. 비밀번호 입력 2. Enter 키 | Sign In 버튼과 동일 동작 | MEDIUM |
| TC-AUTH-006 | 비밀번호 마스킹 | 서버 실행 | 1. 비밀번호 입력 | type=password로 마스킹 표시 | LOW |

### 1.2 세션 관리

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-AUTH-007 | 세션 토큰 발급 | 로그인 성공 | 1. 로그인 2. 쿠키 확인 | amr_session 쿠키 생성 | CRITICAL |
| TC-AUTH-008 | 세션 토큰으로 API 접근 | 유효한 세션 | 1. API 호출 with cookie | 200 OK 응답 | CRITICAL |
| TC-AUTH-009 | 만료된 세션 토큰 | 세션 TTL 초과 | 1. 대기 후 API 호출 | 401 Unauthorized | HIGH |
| TC-AUTH-010 | 세션 없이 API 접근 | 비로그인 상태 | 1. 쿠키 없이 API 호출 | 401 Unauthorized | CRITICAL |
| TC-AUTH-011 | 로그아웃 | 로그인 상태 | 1. 로그아웃 버튼 클릭 | 세션 삭제, 로그인 화면 표시 | HIGH |
| TC-AUTH-012 | 로그아웃 후 뒤로가기 | 로그아웃 완료 | 1. 브라우저 뒤로가기 | 메인 화면 접근 불가, 로그인 화면 | HIGH |
| TC-AUTH-013 | 다중 탭 세션 공유 | 로그인 상태 | 1. 새 탭에서 같은 URL 접속 | 동일 세션으로 로그인 유지 | MEDIUM |
| TC-AUTH-014 | 페이지 새로고침 세션 유지 | 로그인 상태 | 1. F5 또는 새로고침 | 세션 유지, 재로그인 불필요 | HIGH |

### 1.3 Rate Limiting (인증)

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-AUTH-015 | 인증 Rate Limit (5회/60초) | 서버 실행 | 1. 60초 내 6회 로그인 시도 | 6번째부터 429 응답 | HIGH |
| TC-AUTH-016 | Rate Limit 윈도우 초기화 | Rate Limit 도달 | 1. 60초 대기 2. 재시도 | 정상 응답 | MEDIUM |
| TC-AUTH-017 | IP별 독립 Rate Limit | 다른 IP 2개 | 1. IP-A 5회 시도 2. IP-B 시도 | IP-B는 정상 응답 | MEDIUM |

### 1.4 SHARED_PASSWORD 미설정

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-AUTH-018 | 환경변수 미설정 시 동작 | SHARED_PASSWORD 미설정 | 1. 임의 비밀번호로 로그인 | 모든 비밀번호 허용 (B11 버그) | CRITICAL |
| TC-AUTH-019 | 환경변수 빈 문자열 | SHARED_PASSWORD="" | 1. 빈 비밀번호로 로그인 | 동작 확인 필요 | HIGH |
| TC-AUTH-020 | 특수문자 비밀번호 | SHARED_PASSWORD에 특수문자 | 1. 특수문자 포함 비밀번호 입력 | 정상 인증 | MEDIUM |

---

## SECTION 2: 로봇 관리 (40건)

### 2.1 로봇 추가

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-ROBOT-001 | 로봇 추가 (기본) | 로봇 매니저 열기 | 1. IP 입력 2. Robot ID 입력 3. Add Robot 클릭 | 로봇 목록에 추가 | CRITICAL |
| TC-ROBOT-002 | 템플릿 선택 (ULW-100) | 로봇 매니저 열기 | 1. ULW-100 템플릿 선택 2. IP/ID 입력 3. Add | 템플릿 설정 자동 적용 | HIGH |
| TC-ROBOT-003 | 템플릿 선택 (ULW-200) | 로봇 매니저 열기 | 1. ULW-200 선택 2. Add | ULW-200 설정 적용 | HIGH |
| TC-ROBOT-004 | 템플릿 선택 (ULW-300) | 로봇 매니저 열기 | 1. ULW-300 선택 2. Add | ULW-300 설정 적용 | HIGH |
| TC-ROBOT-005 | 템플릿 선택 (SCOUT) | 로봇 매니저 열기 | 1. SCOUT 선택 2. Add | SCOUT 설정 적용 | HIGH |
| TC-ROBOT-006 | 템플릿 선택 (CUSTOM) | 로봇 매니저 열기 | 1. CUSTOM 선택 2. 수동 설정 3. Add | 사용자 정의 설정 저장 | MEDIUM |
| TC-ROBOT-007 | 잘못된 IP 형식 | 로봇 매니저 열기 | 1. "abc.def" 입력 2. Add | 유효성 검증 에러 | HIGH |
| TC-ROBOT-008 | 중복 IP 추가 | 로봇 1대 등록 | 1. 동일 IP로 추가 시도 | 중복 경고 또는 차단 | MEDIUM |
| TC-ROBOT-009 | SSH 포트 설정 | 로봇 매니저 열기 | 1. SSH 포트 2222 입력 2. Add | 포트 2222로 저장 | MEDIUM |
| TC-ROBOT-010 | SSH 포트 범위 (1-65535) | 로봇 매니저 열기 | 1. 포트 0 입력 2. 포트 70000 입력 | 유효 범위 벗어나면 에러 | MEDIUM |
| TC-ROBOT-011 | 터널 모드 활성화 | 로봇 매니저 열기 | 1. Port Forward 체크 2. Add | 터널 모드로 저장 | MEDIUM |
| TC-ROBOT-012 | SSH 비밀번호 저장 | 로봇 매니저 열기 | 1. SSH 비밀번호 입력 2. Add | 비밀번호 저장 (localStorage) | HIGH |

### 2.2 로봇 편집 & 삭제

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-ROBOT-013 | 로봇 정보 수정 | 로봇 1대 등록 | 1. 편집 버튼 클릭 2. IP 변경 3. 저장 | 변경사항 반영 | HIGH |
| TC-ROBOT-014 | 로봇 삭제 | 로봇 1대 등록 | 1. 삭제 버튼 클릭 | 목록에서 제거 | HIGH |
| TC-ROBOT-015 | 연결 중인 로봇 삭제 | 로봇 연결 상태 | 1. 삭제 버튼 클릭 | 연결 해제 후 삭제 또는 경고 | MEDIUM |
| TC-ROBOT-016 | 설정 복제 (Clone) | 로봇 2대 등록 | 1. 소스/대상 선택 2. Clone 클릭 | 대상에 소스 설정 복사 | MEDIUM |

### 2.3 로봇 연결

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-ROBOT-017 | ROS Bridge 연결 | 로봇 등록, 로봇 전원 ON | 1. 로봇 선택 2. 연결 | WebSocket 연결, 상태 "Connected" | CRITICAL |
| TC-ROBOT-018 | 연결 실패 (로봇 OFF) | 로봇 등록, 로봇 전원 OFF | 1. 연결 시도 | 연결 실패 메시지, 상태 "Disconnected" | CRITICAL |
| TC-ROBOT-019 | 연결 실패 (잘못된 IP) | 존재하지 않는 IP | 1. 연결 시도 | 타임아웃 후 실패 메시지 | HIGH |
| TC-ROBOT-020 | 연결 해제 | 연결 상태 | 1. 수동 연결 해제 | 상태 "Disconnected", 구독 정리 | HIGH |
| TC-ROBOT-021 | 자동 재연결 (ON) | 자동 재연결 활성화, 연결 상태 | 1. 네트워크 끊김 시뮬레이션 | 자동 재연결 시도, 성공 시 복원 | HIGH |
| TC-ROBOT-022 | 자동 재연결 (OFF) | 자동 재연결 비활성화 | 1. 네트워크 끊김 | 재연결 시도 안 함 | MEDIUM |
| TC-ROBOT-023 | Latency 표시 | 연결 상태 | 1. 헤더 확인 | "XX ms" 실시간 표시 | MEDIUM |
| TC-ROBOT-024 | Latency 미연결 시 | 미연결 상태 | 1. 헤더 확인 | "--" 표시 | LOW |

### 2.4 다중 로봇

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-ROBOT-025 | 활성 로봇 전환 | 로봇 2대 연결 | 1. 드롭다운에서 다른 로봇 선택 | UI가 선택 로봇 데이터로 전환 | CRITICAL |
| TC-ROBOT-026 | 전환 시 맵 업데이트 | 로봇 2대 연결 | 1. 로봇 전환 | 해당 로봇 맵/위치 표시 | HIGH |
| TC-ROBOT-027 | 전환 시 BMS 업데이트 | 로봇 2대 연결 | 1. 로봇 전환 | 해당 로봇 배터리 정보 표시 | HIGH |
| TC-ROBOT-028 | 전환 시 Work State 업데이트 | 로봇 2대 연결 | 1. 로봇 전환 | 해당 로봇 작업 상태 표시 | HIGH |
| TC-ROBOT-029 | 다중 로봇 버튼 표시 | 로봇 2대 이상 | 1. 헤더 확인 | Fleet/Compare/Config 버튼 표시 | MEDIUM |
| TC-ROBOT-030 | 다중 로봇 버튼 숨김 | 로봇 1대만 | 1. 헤더 확인 | 다중 로봇 버튼 숨김 | MEDIUM |

### 2.5 네트워크 스캔

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-ROBOT-031 | 서브넷 스캔 | 로봇 매니저 열기 | 1. 서브넷 입력 (192.168.1) 2. Scan 클릭 | 발견된 호스트 목록 표시 | HIGH |
| TC-ROBOT-032 | 스캔 결과에서 로봇 추가 | 스캔 완료 | 1. 결과에서 호스트 선택 2. Add | 선택 IP로 로봇 추가 | MEDIUM |
| TC-ROBOT-033 | 스캔 중 상태 표시 | 스캔 시작 | 1. 스캔 진행 중 확인 | "Scanning..." 상태 표시 | LOW |
| TC-ROBOT-034 | 빈 서브넷 스캔 | 사용하지 않는 서브넷 | 1. 미사용 서브넷 스캔 | "No hosts found" 메시지 | LOW |

### 2.6 설정 전파

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-ROBOT-035 | Config Propagate | 로봇 2대 등록 | 1. btn-config-propagate 클릭 2. 소스/대상 선택 3. 실행 | 설정 복사 완료 | MEDIUM |
| TC-ROBOT-036 | Fleet Dashboard | 로봇 2대 연결 | 1. btn-fleet-dashboard 클릭 | 전체 로봇 상태 표시 | MEDIUM |
| TC-ROBOT-037 | Robot Compare | 로봇 2대 연결 | 1. btn-robot-compare 클릭 | 로봇 간 비교표 표시 | MEDIUM |

### 2.7 로봇 설정 저장

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-ROBOT-038 | 로봇 목록 localStorage 저장 | 로봇 추가 후 | 1. 페이지 새로고침 | 로봇 목록 유지 | HIGH |
| TC-ROBOT-039 | robot-config.json 저장 | 서버측 설정 | 1. 로봇 추가 2. 서버 config 확인 | JSON 파일에 저장 | HIGH |
| TC-ROBOT-040 | robot-templates.json 로드 | 서버 시작 | 1. 로봇 매니저 열기 2. 템플릿 확인 | 5개 템플릿 로드 | MEDIUM |

---

## SECTION 3: SSH / 터미널 (46건)

### 3.1 SSH 연결

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-SSH-001 | SSH 연결 (비밀번호) | 로봇 등록, Terminal 탭 | 1. 사용자명/비밀번호 입력 2. Connect 클릭 | SSH 연결, 터미널 프롬프트 표시 | CRITICAL |
| TC-SSH-002 | SSH 연결 실패 (잘못된 비밀번호) | Terminal 탭 | 1. 잘못된 비밀번호 입력 2. Connect | 인증 실패 메시지 | CRITICAL |
| TC-SSH-003 | SSH 연결 실패 (호스트 도달 불가) | Terminal 탭 | 1. 잘못된 IP 2. Connect | 연결 실패 메시지 | HIGH |
| TC-SSH-004 | SSH 연결 해제 | SSH 연결 상태 | 1. Disconnect 클릭 | 연결 종료, 상태 "Disconnected" | HIGH |
| TC-SSH-005 | SSH 재연결 | SSH 연결 해제 후 | 1. 다시 Connect 클릭 | 재연결 성공 | HIGH |
| TC-SSH-006 | SSH 상태 표시 | 연결/미연결 | 1. ssh-status 엘리먼트 확인 | 현재 상태 텍스트 표시 | MEDIUM |
| TC-SSH-007 | Connect 버튼 상태 전환 | - | 1. 연결 전 2. 연결 후 | Connect/Disconnect 버튼 활성/비활성 전환 | LOW |

### 3.2 터미널 기능

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-SSH-008 | 명령어 실행 | SSH 연결 | 1. "ls -la" 입력 2. Enter | 결과 출력 | CRITICAL |
| TC-SSH-009 | 긴 명령어 실행 | SSH 연결 | 1. 1000자 이상 명령어 입력 | 정상 실행 또는 제한 안내 | MEDIUM |
| TC-SSH-010 | sudo 명령어 | SSH 연결 | 1. "sudo ls /root" 입력 | 비밀번호 프롬프트 또는 실행 | HIGH |
| TC-SSH-011 | Tab 자동완성 | SSH 연결 | 1. "ls /ho" 입력 2. Tab | 자동완성 동작 | MEDIUM |
| TC-SSH-012 | 방향키 히스토리 | SSH 연결 | 1. 명령어 실행 2. ↑ 키 | 이전 명령어 호출 | MEDIUM |
| TC-SSH-013 | Ctrl+C 인터럽트 | SSH 연결, 명령 실행 중 | 1. Ctrl+C 입력 | 명령 중단 | HIGH |
| TC-SSH-014 | 출력 스크롤 | SSH 연결 | 1. 대량 출력 명령 (dmesg) | 스크롤 가능, 최신 줄 표시 | MEDIUM |
| TC-SSH-015 | 컬러 출력 | SSH 연결 | 1. "ls --color" 실행 | ANSI 색상 렌더링 | LOW |

### 3.3 다중 터미널

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-SSH-016 | 터미널 추가 | SSH 연결 | 1. "+" 버튼 클릭 | 새 터미널 탭 생성 | HIGH |
| TC-SSH-017 | 터미널 전환 | 2개 이상 터미널 | 1. 다른 터미널 탭 클릭 | 해당 터미널로 전환 | HIGH |
| TC-SSH-018 | 터미널 독립 실행 | 2개 터미널 | 1. 각 터미널에서 다른 명령 실행 | 독립적 동작 | HIGH |
| TC-SSH-019 | 터미널 닫기 | 2개 이상 터미널 | 1. 터미널 탭 닫기 | 해당 터미널만 종료 | MEDIUM |

### 3.4 터미널 검색

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-SSH-020 | 터미널 내 검색 열기 | SSH 연결 | 1. Ctrl+F 또는 검색 바 열기 | 검색 바 표시 | MEDIUM |
| TC-SSH-021 | 키워드 검색 | 터미널 출력 있음 | 1. 검색어 입력 | 매칭 하이라이트 표시 | MEDIUM |
| TC-SSH-022 | 검색 이전/다음 | 여러 매칭 결과 | 1. ↑/↓ 버튼 클릭 | 이전/다음 매칭으로 이동 | LOW |
| TC-SSH-023 | 검색 결과 카운트 | 검색 실행 | 1. 카운트 표시 확인 | "N/M" 형식 표시 | LOW |
| TC-SSH-024 | 검색 닫기 | 검색 바 열린 상태 | 1. X 버튼 클릭 | 검색 바 닫힘, 하이라이트 제거 | LOW |

### 3.5 SSH API (server/routes/ssh.js)

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-SSH-025 | POST /api/ssh/connect | 유효 인증 | 1. host/port/username/password 전송 | 세션 생성, session ID 반환 | CRITICAL |
| TC-SSH-026 | POST /api/ssh/exec | SSH 세션 | 1. sessionId + command 전송 | stdout/stderr/exitCode 반환 | CRITICAL |
| TC-SSH-027 | POST /api/ssh/disconnect | SSH 세션 | 1. sessionId 전송 | 세션 종료 | HIGH |
| TC-SSH-028 | exec 빈 명령어 | SSH 세션 | 1. command="" 전송 | 유효성 에러 | MEDIUM |
| TC-SSH-029 | exec 최대길이 (8192자) | SSH 세션 | 1. 8193자 명령어 전송 | 유효성 에러 | MEDIUM |
| TC-SSH-030 | exec 명령 인젝션 방어 | SSH 세션 | 1. "; rm -rf /" 포함 명령 | 유효성 검증 또는 샌드박스 | CRITICAL |
| TC-SSH-031 | 존재하지 않는 세션 exec | - | 1. 잘못된 sessionId로 exec | 에러 응답 | HIGH |
| TC-SSH-032 | 세션 타임아웃 | SSH 세션 | 1. 장시간 미사용 | 세션 자동 종료 | MEDIUM |

### 3.6 Init Setup SSH (public/js/init-setup.js)

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-SSH-033 | Init Setup 연결 | Setup 모달 열기 | 1. IP/Port/User/PW 입력 2. Connect | SSH 연결, 시스템 정보 표시 | CRITICAL |
| TC-SSH-034 | Init Setup 연결 해제 | Setup 연결 상태 | 1. Disconnect 클릭 | 연결 해제 | HIGH |
| TC-SSH-035 | 시스템 정보 표시 | Setup 연결 | 1. 시스템 정보 패널 확인 | Ubuntu 버전, ROS 버전, LAN 카드 표시 | HIGH |
| TC-SSH-036 | 네트워크 설정 로드 | Setup 연결 | 1. Load Current 클릭 | 현재 네트워크 설정 로드 | HIGH |
| TC-SSH-037 | 네트워크 설정 적용 | Setup 연결, 설정 입력 | 1. IP/Subnet 입력 2. Apply Settings | /etc/network/interfaces 수정 | CRITICAL |
| TC-SSH-038 | sudo 비밀번호 파이핑 | Setup 연결 | 1. sudo 명령 실행 | printf pipe로 sudo -S 실행 | CRITICAL |
| TC-SSH-039 | base64 파일 쓰기 | Setup 연결 | 1. 파일 쓰기 작업 | base64 인코딩→디코딩 방식 | HIGH |
| TC-SSH-040 | .bashrc 환경변수 로드 | Setup 연결, bashrc 탭 | 1. Load 클릭 | 현재 환경변수 목록 표시 | HIGH |
| TC-SSH-041 | .bashrc 환경변수 저장 | Setup 연결, 변수 수정 | 1. Save 클릭 | .bashrc 파일 업데이트 | HIGH |
| TC-SSH-042 | 환경변수 추가 | Setup 연결 | 1. Key/Value 입력 2. Add | 새 환경변수 추가 | MEDIUM |
| TC-SSH-043 | /etc/hosts 로드 | Setup 연결, hosts 탭 | 1. Load 클릭 | hosts 파일 내용 표시 | HIGH |
| TC-SSH-044 | /etc/hosts 저장 | Setup 연결, 내용 수정 | 1. Save 클릭 | hosts 파일 업데이트 | HIGH |
| TC-SSH-045 | Setup 모달 닫기 | Setup 모달 열린 상태 | 1. X 버튼 클릭 | 모달 닫힘 (연결 유지 or 해제) | LOW |
| TC-SSH-046 | 비활성 입력 필드 | Setup 미연결 | 1. 입력 필드 확인 | 네트워크/bashrc/hosts 필드 disabled | LOW |

---

## SECTION 4: 파일 전송 - SFTP (42건)

### 4.1 파일 탐색

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-SFTP-001 | 원격 디렉토리 탐색 | SSH 연결, Files 탭 | 1. 경로 입력 (/home) 2. Browse | 파일/디렉토리 목록 표시 | CRITICAL |
| TC-SFTP-002 | 하위 디렉토리 이동 | 디렉토리 목록 표시 | 1. 디렉토리명 클릭 | 해당 디렉토리 내용 표시 | HIGH |
| TC-SFTP-003 | 상위 디렉토리 이동 | 하위 디렉토리 | 1. ".." 또는 상위 이동 | 상위 디렉토리 표시 | HIGH |
| TC-SFTP-004 | 파일 정보 표시 | 디렉토리 탐색 | 1. 파일 목록 확인 | 이름, 크기, 수정일, 액션 표시 | MEDIUM |
| TC-SFTP-005 | 빈 디렉토리 표시 | 빈 디렉토리 | 1. 빈 디렉토리 탐색 | "Empty directory" 또는 빈 테이블 | LOW |
| TC-SFTP-006 | 존재하지 않는 경로 | - | 1. 잘못된 경로 입력 2. Browse | 에러 메시지 | MEDIUM |
| TC-SFTP-007 | 권한 없는 디렉토리 | /root 등 | 1. 접근 제한 경로 탐색 | Permission denied 에러 | MEDIUM |

### 4.2 파일 다운로드

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-SFTP-008 | 파일 다운로드 | 파일 목록 표시 | 1. 파일 다운로드 버튼 클릭 | 파일 브라우저 다운로드 시작 | CRITICAL |
| TC-SFTP-009 | 대용량 파일 다운로드 | 100MB+ 파일 | 1. 다운로드 클릭 | 다운로드 진행 (메모리 주의 B5) | HIGH |
| TC-SFTP-010 | 텍스트 파일 미리보기 | .txt/.log 파일 | 1. 파일 클릭 | 내용 미리보기 표시 | MEDIUM |
| TC-SFTP-011 | 바이너리 파일 처리 | .bin/.img 파일 | 1. 다운로드 클릭 | 정상 다운로드 (미리보기 불가) | MEDIUM |

### 4.3 파일 업로드

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-SFTP-012 | 파일 업로드 | SSH 연결, Files 탭 | 1. 파일 선택 2. Upload 클릭 | 파일 업로드 완료 메시지 | CRITICAL |
| TC-SFTP-013 | 업로드 진행 상태 | 업로드 중 | 1. upload-status 확인 | 진행 상태 표시 | MEDIUM |
| TC-SFTP-014 | 업로드 성공 후 목록 갱신 | 업로드 완료 | 1. 파일 목록 확인 | 업로드된 파일 목록에 표시 | HIGH |
| TC-SFTP-015 | 업로드 실패 (디스크 풀) | 용량 부족 | 1. 업로드 시도 | 에러 메시지 표시 | HIGH |
| TC-SFTP-016 | 업로드 실패 (권한 없음) | 쓰기 권한 없는 경로 | 1. 업로드 시도 | Permission denied 에러 | HIGH |
| TC-SFTP-017 | 업로드 후 로컬 파일 유지 | - | 1. 업로드 2. 서버 임시파일 확인 | 성공 시에만 임시파일 삭제 (B1) | CRITICAL |
| TC-SFTP-018 | 파일 미선택 업로드 | - | 1. 파일 미선택 2. Upload 클릭 | 에러 또는 비활성 | LOW |

### 4.4 파일 비교 (Diff)

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-SFTP-019 | 파일 Diff 열기 | Files 탭 | 1. btn-file-diff 클릭 | Diff 뷰어 열기 | MEDIUM |
| TC-SFTP-020 | 두 파일 비교 | Diff 뷰어 | 1. 파일 2개 선택 2. 비교 | 차이점 하이라이트 표시 | MEDIUM |
| TC-SFTP-021 | 동일 파일 비교 | Diff 뷰어 | 1. 같은 파일 2개 | "No differences" 메시지 | LOW |
| TC-SFTP-022 | 바이너리 파일 Diff | Diff 뷰어 | 1. 바이너리 파일 선택 | 비교 불가 메시지 | LOW |

### 4.5 SFTP API (server/routes/sftp.js)

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-SFTP-023 | POST /api/sftp/list | 유효 세션 | 1. path 전송 | 파일 목록 JSON | CRITICAL |
| TC-SFTP-024 | POST /api/sftp/download | 유효 세션 | 1. filePath 전송 | base64 인코딩 파일 데이터 | CRITICAL |
| TC-SFTP-025 | POST /api/sftp/upload | 유효 세션 | 1. file + remotePath 전송 | 업로드 성공 응답 | CRITICAL |
| TC-SFTP-026 | POST /api/sftp/mkdir | 유효 세션 | 1. path 전송 | 디렉토리 생성 | HIGH |
| TC-SFTP-027 | POST /api/sftp/delete | 유효 세션 | 1. filePath 전송 | 파일 삭제 | HIGH |
| TC-SFTP-028 | POST /api/sftp/rename | 유효 세션 | 1. oldPath, newPath 전송 | 파일 이름 변경 | MEDIUM |
| TC-SFTP-029 | 경로 탐색(traversal) 방어 | - | 1. "../../../etc/passwd" 시도 | 경로 검증 차단 | CRITICAL |
| TC-SFTP-030 | 인증 없는 SFTP 요청 | 미인증 | 1. 세션 없이 API 호출 | 401 Unauthorized | HIGH |

### 4.6 파일 관리 작업

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-SFTP-031 | 디렉토리 생성 | Files 탭, 경로 탐색 | 1. 새 디렉토리 생성 | 디렉토리 생성 완료 | HIGH |
| TC-SFTP-032 | 파일 삭제 | 파일 목록 | 1. 파일 삭제 버튼 클릭 | 파일 삭제, 목록 갱신 | HIGH |
| TC-SFTP-033 | 파일 이름 변경 | 파일 목록 | 1. 이름 변경 | 새 이름으로 표시 | MEDIUM |
| TC-SFTP-034 | 디렉토리 삭제 (비어있지 않음) | 파일 있는 디렉토리 | 1. 삭제 시도 | 경고 또는 재귀 삭제 확인 | MEDIUM |
| TC-SFTP-035 | 숨김 파일 표시 | . 으로 시작하는 파일 | 1. 목록 확인 | 숨김 파일 표시 여부 | LOW |
| TC-SFTP-036 | 심볼릭 링크 처리 | 심볼릭 링크 파일 | 1. 링크 클릭 | 원본 파일/디렉토리 접근 | LOW |
| TC-SFTP-037 | 특수문자 파일명 | 공백/한글 포함 파일 | 1. 파일 탐색 | 정상 표시 및 다운로드 | MEDIUM |
| TC-SFTP-038 | 대량 파일 목록 (1000+) | 1000개 이상 파일 | 1. 디렉토리 탐색 | 목록 표시 (페이징 또는 스크롤) | MEDIUM |
| TC-SFTP-039 | 동시 업로드 처리 | - | 1. 여러 파일 동시 업로드 | 순차 또는 병렬 처리 | MEDIUM |
| TC-SFTP-040 | 업로드 실패 시 재시도 | 네트워크 불안정 | 1. 업로드 실패 2. 재시도 | 재업로드 가능 | MEDIUM |
| TC-SFTP-041 | 파일 크기 포맷 | 다양한 크기 파일 | 1. 크기 확인 | B/KB/MB/GB 적절 포맷 | LOW |
| TC-SFTP-042 | 수정일 포맷 | 파일 목록 | 1. 날짜 확인 | 읽기 쉬운 날짜 형식 | LOW |

---

## SECTION 5: 터널링 (20건)

### 5.1 터널 생성

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-TUN-001 | SSH 터널 생성 | 터널 모드 로봇 | 1. 로봇 연결 시도 | SSH 터널 자동 생성 | CRITICAL |
| TC-TUN-002 | 로컬 포트 할당 | 터널 생성 | 1. 터널 상태 확인 | 고유 로컬 포트 할당 | HIGH |
| TC-TUN-003 | ROS Bridge 터널링 | 터널 생성 | 1. ROS 연결 확인 | localhost:port → remote:9090 연결 | CRITICAL |
| TC-TUN-004 | 다중 터널 생성 | 로봇 2대 터널 모드 | 1. 각각 연결 | 독립 터널 2개 생성 | HIGH |
| TC-TUN-005 | 터널 포트 충돌 방지 | 다중 터널 | 1. 포트 할당 확인 | 각 터널 다른 포트 사용 | HIGH |

### 5.2 터널 유지

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-TUN-006 | 터널 상태 모니터링 | 터널 활성 | 1. 터널 상태 확인 | 활성 상태 표시 | HIGH |
| TC-TUN-007 | 터널 끊김 감지 | 터널 활성 | 1. 원격 호스트 네트워크 끊기 | 터널 끊김 감지 | HIGH |
| TC-TUN-008 | 터널 자동 재생성 | 터널 끊김 | 1. 네트워크 복구 대기 | 자동 재연결 시도 | MEDIUM |
| TC-TUN-009 | 터널 수동 재연결 | 터널 끊김 | 1. 수동 재연결 | 터널 재생성 | MEDIUM |

### 5.3 터널 종료

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-TUN-010 | 터널 정상 종료 | 터널 활성 | 1. 로봇 연결 해제 | 터널 프로세스 종료 | HIGH |
| TC-TUN-011 | 서버 종료 시 터널 정리 | 터널 활성 | 1. 서버 종료 | 모든 터널 프로세스 종료 | HIGH |
| TC-TUN-012 | 고아 프로세스 방지 | 터널 활성 | 1. 비정상 종료 시뮬레이션 | sshpass 프로세스 잔존 여부 확인 | HIGH |

### 5.4 터널 API (server/routes/tunnel.js)

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-TUN-013 | POST /api/tunnel/create | 유효 인증 | 1. host/port/password 전송 | 터널 생성, 로컬 포트 반환 | CRITICAL |
| TC-TUN-014 | POST /api/tunnel/destroy | 활성 터널 | 1. tunnelId 전송 | 터널 종료 | HIGH |
| TC-TUN-015 | GET /api/tunnel/status | - | 1. 상태 조회 | 활성 터널 목록 | MEDIUM |
| TC-TUN-016 | 명령 인젝션 방어 (IP) | - | 1. IP에 "; rm -rf /" 삽입 | 유효성 검증 차단 (S2) | CRITICAL |
| TC-TUN-017 | 명령 인젝션 방어 (Port) | - | 1. Port에 악성 코드 삽입 | 유효성 검증 차단 | CRITICAL |
| TC-TUN-018 | 비인증 터널 생성 | 미인증 | 1. 세션 없이 요청 | 401 Unauthorized | HIGH |
| TC-TUN-019 | 동시 터널 제한 | 다수 터널 | 1. 최대 수 초과 생성 | 제한 또는 경고 | MEDIUM |
| TC-TUN-020 | sshpass 프로세스 노출 (S4) | 터널 활성 | 1. ps aux 확인 | 비밀번호 ps 노출 여부 확인 | HIGH |

---

## SECTION 6: 테스트 모드 (24건)

### 6.1 테스트 모드 시작/종료

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-TEST-001 | 테스트 모드 시작 | 로봇 미연결 | 1. Test Mode 버튼 클릭 | roscore 시작, 시뮬레이션 데이터 생성 | CRITICAL |
| TC-TEST-002 | 시작 로딩 오버레이 | 테스트 모드 시작 중 | 1. 오버레이 확인 | 단계별 진행 표시, 프로그레스 바 | MEDIUM |
| TC-TEST-003 | 테스트 모드 종료 | 테스트 모드 활성 | 1. Test Mode 버튼 재클릭 | roscore 종료, 시뮬레이션 중지 | CRITICAL |
| TC-TEST-004 | 테스트 모드 칩 표시 | 테스트 모드 활성 | 1. 헤더 확인 | test-mode-chip 표시 | MEDIUM |
| TC-TEST-005 | 테스트 모드 상태 표시 | 테스트 모드 활성 | 1. test-mode-status 확인 | "TEST MODE" 텍스트 | LOW |

### 6.2 시뮬레이션 데이터

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-TEST-006 | BMS 시뮬레이션 | 테스트 모드 | 1. BMS 데이터 확인 | SOC/전압/전류 시뮬레이션 값 표시 | HIGH |
| TC-TEST-007 | Work State 시뮬레이션 | 테스트 모드 | 1. 작업 상태 확인 | 시뮬레이션 작업 상태 표시 | HIGH |
| TC-TEST-008 | 로봇 위치 시뮬레이션 | 테스트 모드 | 1. 맵 확인 | 시뮬레이션 로봇 위치 표시 | HIGH |
| TC-TEST-009 | LiDAR 시뮬레이션 | 테스트 모드 | 1. LiDAR 활성화 | 시뮬레이션 LiDAR 포인트 표시 | MEDIUM |
| TC-TEST-010 | 맵 시뮬레이션 | 테스트 모드 | 1. 맵 활성화 | 시뮬레이션 맵 렌더링 | MEDIUM |
| TC-TEST-011 | 카메라 시뮬레이션 | 테스트 모드 | 1. Camera 탭 | 시뮬레이션 이미지 표시 | MEDIUM |

### 6.3 테스트 모드 제약

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-TEST-012 | 실 로봇 연결 시 비활성 | 로봇 연결 상태 | 1. Test Mode 버튼 확인 | 비활성 또는 경고 | HIGH |
| TC-TEST-013 | 로컬 전용 API | 외부 IP | 1. 외부에서 /api/testmode 호출 | 127.0.0.1 제한, 외부 차단 | CRITICAL |
| TC-TEST-014 | roscore 프로세스 관리 | 테스트 모드 종료 | 1. ps aux로 roscore 확인 | 프로세스 정상 종료 (B3 확인) | CRITICAL |

### 6.4 테스트 모드 + 기능 통합

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-TEST-015 | Jog Control 테스트 모드 | 테스트 모드 | 1. Jog 패널 열기 2. 방향키 조작 | cmd_vel 발행, 시뮬레이션 위치 변경 | HIGH |
| TC-TEST-016 | Action Send 테스트 모드 | 테스트 모드 | 1. Action 전송 | 시뮬레이션 액션 실행 | HIGH |
| TC-TEST-017 | SLAM 테스트 모드 | 테스트 모드 | 1. SLAM 시작 | 시뮬레이션 SLAM 동작 | MEDIUM |
| TC-TEST-018 | NavGoal 테스트 모드 | 테스트 모드 | 1. 맵 클릭 NavGoal | 시뮬레이션 네비게이션 | MEDIUM |
| TC-TEST-019 | switchActiveRobot 비밀번호 전달 (B4) | 다중 로봇 테스트 모드 | 1. 로봇 전환 | TestMode.start()에 password 전달 | CRITICAL |

### 6.5 테스트 모드 API

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-TEST-020 | POST /api/testmode/start | localhost | 1. 시작 요청 | roscore 시작, 200 OK | CRITICAL |
| TC-TEST-021 | POST /api/testmode/stop | 테스트 모드 활성 | 1. 종료 요청 | roscore 종료, 200 OK | CRITICAL |
| TC-TEST-022 | GET /api/testmode/status | - | 1. 상태 조회 | running: true/false | MEDIUM |
| TC-TEST-023 | 원격 IP 차단 | 외부 IP | 1. 외부에서 start 요청 | 403 Forbidden | CRITICAL |
| TC-TEST-024 | 이미 실행 중 재시작 | 테스트 모드 활성 | 1. start 재요청 | 이미 실행 중 메시지 또는 무시 | MEDIUM |

---

## SECTION 7: ROS 통합 (39건)

### 7.1 ROS Bridge 연결

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-ROS-001 | WebSocket 연결 | 로봇 전원 ON | 1. 로봇 연결 | ws://IP:9090 연결 | CRITICAL |
| TC-ROS-002 | 연결 성공 콜백 | 연결 시도 | 1. 연결 성공 대기 | onConnection 콜백 호출 | HIGH |
| TC-ROS-003 | 연결 실패 콜백 | 잘못된 IP | 1. 연결 시도 | onError/onClose 콜백 호출 | HIGH |
| TC-ROS-004 | 연결 끊김 감지 | 연결 상태 | 1. 로봇 전원 OFF | onClose 콜백, 상태 업데이트 | HIGH |
| TC-ROS-005 | TF 수신 플래그 | 연결 후 | 1. TF 데이터 대기 | tfReceived = true 설정 | MEDIUM |

### 7.2 토픽 구독

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-ROS-006 | BMS 토픽 구독 | ROS 연결 | 1. BMS 체크박스 활성화 | BMS 데이터 실시간 수신 | CRITICAL |
| TC-ROS-007 | Map 토픽 구독 | ROS 연결 | 1. Map 체크박스 활성화 | 맵 데이터 수신, 렌더링 | CRITICAL |
| TC-ROS-008 | Robot Pose 구독 | ROS 연결 | 1. Robot Pose 활성화 | 로봇 위치 실시간 수신 | CRITICAL |
| TC-ROS-009 | LiDAR 구독 | ROS 연결 | 1. LiDAR 활성화 | LiDAR 포인트 수신, 렌더링 | HIGH |
| TC-ROS-010 | 카메라 구독 (Cam1 Color) | ROS 연결 | 1. Cam1 Color 활성화 | 카메라 이미지 수신 | HIGH |
| TC-ROS-011 | 카메라 구독 (Cam2 Color) | ROS 연결 | 1. Cam2 Color 활성화 | 카메라 이미지 수신 | HIGH |
| TC-ROS-012 | 카메라 구독 (Depth) | ROS 연결 | 1. Depth 체크박스 활성화 | Depth 이미지 수신 | MEDIUM |
| TC-ROS-013 | 토픽 구독 해제 | 구독 중 | 1. 체크박스 비활성화 | 토픽 구독 해제, 메모리 정리 | HIGH |
| TC-ROS-014 | 커스텀 토픽 구독 | ROS Control 탭 | 1. 토픽/타입 입력 2. Subscribe | 데이터 수신, 표시 | HIGH |
| TC-ROS-015 | 커스텀 토픽 해제 | 구독 중 | 1. Unsubscribe 클릭 | 구독 해제 | HIGH |
| TC-ROS-016 | 토픽 스로틀링 | ROS Control 탭 | 1. Hz 설정 (1-100) 2. Subscribe | 설정 Hz로 제한된 수신 | MEDIUM |
| TC-ROS-017 | 토픽 필터 (JSONPath) | 구독 중 | 1. 필터 입력 | 필터링된 데이터만 표시 | MEDIUM |

### 7.3 ROS 정보 조회

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-ROS-018 | 노드 목록 조회 | ROS 연결 | 1. Refresh nodes | 실행 중인 노드 목록 표시 | HIGH |
| TC-ROS-019 | 토픽 목록 조회 | ROS 연결 | 1. Refresh topics | 활성 토픽 목록 표시 | HIGH |
| TC-ROS-020 | 서비스 목록 조회 | ROS 연결 | 1. Refresh services | 서비스 목록 표시 | HIGH |
| TC-ROS-021 | 파라미터 목록 조회 | ROS 연결 | 1. Refresh params | 파라미터 목록 표시 | HIGH |
| TC-ROS-022 | 노드 검색 필터 | 노드 목록 | 1. 검색어 입력 | 매칭 노드만 표시 | MEDIUM |
| TC-ROS-023 | 토픽 검색 필터 | 토픽 목록 | 1. 검색어 입력 | 매칭 토픽만 표시 | MEDIUM |
| TC-ROS-024 | 노드 Kill | 노드 목록 | 1. 노드 선택 2. Kill 클릭 | 노드 종료 | HIGH |
| TC-ROS-025 | 서비스 호출 | ROS Control 탭 | 1. 서비스명/인자 입력 2. Call | 서비스 응답 표시 | HIGH |
| TC-ROS-026 | 파라미터 Get | ROS Control 탭 | 1. 파라미터명 입력 2. Get | 파라미터 값 표시 | HIGH |
| TC-ROS-027 | 파라미터 Set | ROS Control 탭 | 1. 파라미터명/값 입력 2. Set | 파라미터 변경 성공 | HIGH |
| TC-ROS-028 | 토픽 타입 브라우저 | ROS Control 탭 | 1. Browse Types 클릭 | 메시지 타입 구조 표시 | MEDIUM |
| TC-ROS-029 | rosout 뷰어 시작 | ROS Control 탭 | 1. Start 클릭 | /rosout 메시지 실시간 표시 | MEDIUM |
| TC-ROS-030 | rosout 레벨 필터 | rosout 활성 | 1. 레벨 선택 (Warn+) | 해당 레벨 이상만 표시 | MEDIUM |
| TC-ROS-031 | rosout 검색 | rosout 활성 | 1. 검색어 입력 | 매칭 메시지만 표시 | LOW |
| TC-ROS-032 | ROS Favorites 추가 | ROS Control 탭 | 1. 항목 즐겨찾기 추가 | 즐겨찾기 목록에 표시 | MEDIUM |
| TC-ROS-033 | ROS Favorites 삭제 | 즐겨찾기 있음 | 1. Clear 클릭 | 즐겨찾기 목록 초기화 | LOW |

### 7.4 SLAM / Lifelong / Map Edit

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-ROS-034 | SLAM 시작 | ROS 연결 | 1. Start SLAM 클릭 | SLAM 모드 진입, 맵 생성 시작 | CRITICAL |
| TC-ROS-035 | SLAM 종료 | SLAM 실행 중 | 1. Stop SLAM 클릭 | NAV 모드 복귀, SLAM 맵 정리 | CRITICAL |
| TC-ROS-036 | SLAM→NAV 전환 후 맵 | SLAM 종료 후 | 1. 맵 확인 | NAV 맵으로 복원 (lastMapMsg 초기화) | CRITICAL |
| TC-ROS-037 | Lifelong 시작/종료 | ROS 연결 | 1. Start/Stop Lifelong | 정상 동작, 맵 정리 | HIGH |
| TC-ROS-038 | Map Edit 활성화 | 맵 표시 중 | 1. Edit Map 클릭 | 편집 도구 표시, 맵 위 그리기 가능 | HIGH |
| TC-ROS-039 | Map Edit 저장 | 맵 편집 후 | 1. Save 클릭 | 편집된 맵 저장, 적용 옵션 | HIGH |

---

## SECTION 8: UI 컴포넌트 & 인터랙션 (118건)

### 8.1 탭 네비게이션

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-UI-001 | Dashboard 탭 전환 | 로그인 상태 | 1. Dashboard 탭 클릭 | Dashboard 콘텐츠 표시 | CRITICAL |
| TC-UI-002 | ROS Control 탭 전환 | 로그인 상태 | 1. ROS Control 클릭 | ROS 정보 표시 | CRITICAL |
| TC-UI-003 | Tasks 탭 전환 | 로그인 상태 | 1. Tasks 클릭 | 액션 전송 UI 표시 | CRITICAL |
| TC-UI-004 | Camera 탭 전환 | 로그인 상태 | 1. Camera 클릭 | 카메라 뷰 표시 | HIGH |
| TC-UI-005 | Terminal 탭 전환 | 로그인 상태 | 1. Terminal 클릭 | SSH 터미널 표시, xterm fit | HIGH |
| TC-UI-006 | Batch 탭 전환 | 로그인 상태 | 1. Batch 클릭 | 배치 명령 UI 표시 | MEDIUM |
| TC-UI-007 | Files 탭 전환 | 로그인 상태 | 1. Files 클릭 | 파일 전송 UI 표시 | HIGH |
| TC-UI-008 | Docking 탭 전환 | 로그인 상태 | 1. Docking 클릭 | 도킹 테스트 UI 표시 | HIGH |
| TC-UI-009 | Monitor 탭 전환 | 로그인 상태 | 1. Monitor 클릭 | 모니터링 카드 표시 | HIGH |
| TC-UI-010 | Scheduler 탭 전환 | 로그인 상태 | 1. Scheduler 클릭 | 스케줄러 UI 표시 | MEDIUM |
| TC-UI-011 | 활성 탭 .active 클래스 | 탭 전환 | 1. 탭 클릭 2. 클래스 확인 | 선택 탭에 .active 클래스 | LOW |
| TC-UI-012 | 탭 상태 localStorage 저장 | 탭 전환 | 1. 탭 전환 2. 새로고침 | 마지막 탭 복원 | MEDIUM |
| TC-UI-013 | Split View 탭 선택 | 로그인 상태 | 1. 2nd Tab 드롭다운 선택 | 하단에 두 번째 탭 표시 | MEDIUM |

### 8.2 맵 컨트롤

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-UI-014 | 맵 체크박스 ON | 맵 패널 | 1. chk-map 체크 | 맵 캔버스에 맵 렌더링 | CRITICAL |
| TC-UI-015 | 맵 체크박스 OFF | 맵 표시 중 | 1. chk-map 해제 | 맵 비표시 | HIGH |
| TC-UI-016 | 로봇 위치 체크박스 | 맵 패널 | 1. chk-robot-pose 토글 | 로봇 아이콘 표시/숨김 | HIGH |
| TC-UI-017 | LiDAR 체크박스 | 맵 패널 | 1. chk-lidar 토글 | LiDAR 포인트 표시/숨김 | HIGH |
| TC-UI-018 | 로봇 아이콘 스타일 변경 | 맵 패널 | 1. robot-icon-style 변경 | 선택 스타일로 아이콘 변경 | LOW |
| TC-UI-019 | LiDAR 색상 변경 | 맵 패널 | 1. lidar-color 변경 | LiDAR 포인트 색상 변경 | LOW |
| TC-UI-020 | LiDAR 포인트 크기 | 맵 패널 | 1. lidar-point-size 슬라이더 | 포인트 크기 변경 | LOW |
| TC-UI-021 | 줌 인 | 맵 패널 | 1. + 버튼 클릭 | 맵 확대 | HIGH |
| TC-UI-022 | 줌 아웃 | 맵 패널 | 1. - 버튼 클릭 | 맵 축소 | HIGH |
| TC-UI-023 | 줌 리셋 | 맵 패널 | 1. 1:1 버튼 클릭 | 100% 줌으로 복원 | MEDIUM |
| TC-UI-024 | 줌 값 표시 | 줌 변경 | 1. map-zoom-value 확인 | 현재 줌 % 표시 | LOW |
| TC-UI-025 | 회전 좌 | 맵 패널 | 1. ↺ 버튼 클릭 | 맵 반시계방향 회전 | MEDIUM |
| TC-UI-026 | 회전 우 | 맵 패널 | 1. ↻ 버튼 클릭 | 맵 시계방향 회전 | MEDIUM |
| TC-UI-027 | 회전 리셋 | 맵 패널 | 1. R 버튼 클릭 | 0° 회전으로 복원 | MEDIUM |
| TC-UI-028 | InitPose 모드 | 맵 패널 | 1. InitPose 버튼 클릭 2. 맵 클릭+드래그 | 초기 위치/방향 설정 | CRITICAL |
| TC-UI-029 | NavGoal 모드 | 맵 패널 | 1. NavGoal 버튼 클릭 2. 맵 클릭 | 네비게이션 목표 팝업 | CRITICAL |
| TC-UI-030 | Follow Robot 토글 | 맵 패널 | 1. Follow 버튼 클릭 | 로봇 위치 자동 추적 | MEDIUM |
| TC-UI-031 | Fullscreen 모드 | 맵 패널 | 1. Fullscreen 버튼 | 맵 전체화면 | MEDIUM |
| TC-UI-032 | Fullscreen 해제 (ESC) | 전체화면 | 1. ESC 키 | 전체화면 해제 | MEDIUM |
| TC-UI-033 | 맵 패널 접기 | 맵 패널 | 1. Collapse 버튼 클릭 | 맵 패널 접힘, 확장 버튼 표시 | MEDIUM |
| TC-UI-034 | 맵 패널 펼치기 | 맵 접힌 상태 | 1. MAP 확장 버튼 클릭 | 맵 패널 펼침 | MEDIUM |

### 8.3 POI 관리

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-UI-035 | POI 추가 | 로봇 위치 표시 | 1. +POI 클릭 | 현재 위치를 POI로 저장 | HIGH |
| TC-UI-036 | POI 선택 | POI 등록됨 | 1. poi-select 드롭다운 선택 | POI 선택됨 | MEDIUM |
| TC-UI-037 | POI로 이동 | POI 선택 | 1. Go 버튼 클릭 | 선택 POI로 네비게이션 | HIGH |
| TC-UI-038 | POI 삭제 | POI 선택 | 1. Del 버튼 클릭 | POI 삭제 | MEDIUM |
| TC-UI-039 | POI 일괄 관리 | POI 등록됨 | 1. POI... 버튼 클릭 | Import/Export 옵션 표시 | MEDIUM |

### 8.4 Nav Goal 팝업

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-UI-040 | NavGoal 팝업 표시 | NavGoal 모드 | 1. 맵 클릭 | 좌표/파라미터 팝업 표시 | HIGH |
| TC-UI-041 | NavGoal 좌표 표시 | 팝업 표시 | 1. X/Y/Yaw 확인 | 클릭 좌표 표시 | MEDIUM |
| TC-UI-042 | NavGoal 최대속도 | 팝업 표시 | 1. max-vel 입력 (0.1~2.0) | 유효 범위 제한 | MEDIUM |
| TC-UI-043 | NavGoal Passing 옵션 | 팝업 표시 | 1. passing 선택 | Stop/Pass through 선택 | MEDIUM |
| TC-UI-044 | NavGoal Avoid 옵션 | 팝업 표시 | 1. avoid 선택 | Avoid ON/OFF 선택 | MEDIUM |
| TC-UI-045 | NavGoal 전송 | 팝업 표시 | 1. Send 클릭 | 네비게이션 목표 발행 | HIGH |
| TC-UI-046 | NavGoal 취소 | 팝업 표시 | 1. Cancel 클릭 | 팝업 닫힘 | LOW |

### 8.5 헤더 컴포넌트

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-UI-047 | Work State 바 표시 | ROS 연결 | 1. 헤더 확인 | 컬러 바 + 텍스트 표시 | HIGH |
| TC-UI-048 | BMS 게이지 표시 | ROS 연결 | 1. 헤더 확인 | 원형 게이지 + 퍼센트 표시 | HIGH |
| TC-UI-049 | BMS 충전 아이콘 | 충전 중 | 1. 충전 아이콘 확인 | 충전 아이콘 표시 | MEDIUM |
| TC-UI-050 | BMS Detail 모달 | 로그인 상태 | 1. BMS Detail 버튼 클릭 | 상세 BMS 정보 모달 | MEDIUM |
| TC-UI-051 | Operation Mode 토글 | 로그인 상태 | 1. 모드 버튼 클릭 | MANUAL ↔ AUTO 전환 | HIGH |
| TC-UI-052 | 테마 토글 (다크/라이트) | 로그인 상태 | 1. 테마 버튼 클릭 | 다크 ↔ 라이트 전환 | MEDIUM |
| TC-UI-053 | 테마 localStorage 저장 | 테마 변경 | 1. 새로고침 | 선택 테마 유지 | MEDIUM |
| TC-UI-054 | 폰트 크기 S | More 메뉴 | 1. S 버튼 클릭 | 폰트 작게 | LOW |
| TC-UI-055 | 폰트 크기 M | More 메뉴 | 1. M 버튼 클릭 | 폰트 보통 | LOW |
| TC-UI-056 | 폰트 크기 L | More 메뉴 | 1. L 버튼 클릭 | 폰트 크게 | LOW |
| TC-UI-057 | 폰트 크기 XL | More 메뉴 | 1. XL 버튼 클릭 | 폰트 매우 크게 | LOW |
| TC-UI-058 | 폰트 크기 localStorage 저장 | 폰트 변경 | 1. 새로고침 | 선택 폰트 유지 | LOW |
| TC-UI-059 | More 메뉴 열기 | 헤더 | 1. ⋮ 버튼 클릭 | 드롭다운 메뉴 표시 | MEDIUM |
| TC-UI-060 | More 메뉴 외부 클릭 닫기 | 메뉴 열림 | 1. 메뉴 외부 클릭 | 메뉴 닫힘 | MEDIUM |

### 8.6 Dashboard 위젯

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-UI-061 | Work State 타임라인 | Dashboard 탭 | 1. 타임라인 캔버스 확인 | 시간축 상태 변화 표시 | HIGH |
| TC-UI-062 | BMS Trend 그래프 | Dashboard 탭 | 1. BMS 그래프 확인 | SOC/전압/전류 추이 표시 | HIGH |
| TC-UI-063 | BMS 메트릭 선택 | Dashboard 탭 | 1. bms-trend-metric 변경 | 선택 메트릭 그래프 표시 | MEDIUM |
| TC-UI-064 | BMS CSV 내보내기 | Dashboard 탭 | 1. Export to CSV 클릭 | CSV 파일 다운로드 | MEDIUM |
| TC-UI-065 | Topic Hz 모니터 | Dashboard 탭 | 1. Topic Hz 그리드 확인 | BMS/WS/Pose/Map/LiDAR Hz 표시 | HIGH |
| TC-UI-066 | Topic Hz 미수신 시 | 토픽 미수신 | 1. Hz 값 확인 | "--" 표시 | MEDIUM |
| TC-UI-067 | Integration Test 실행 | Dashboard 탭 | 1. Run Test 클릭 | 테스트 진행, 프로그레스 바 | HIGH |
| TC-UI-068 | Integration Test 결과 | 테스트 완료 | 1. 결과 확인 | pass/fail 표시 | HIGH |
| TC-UI-069 | Integration Test 리포트 저장 | 테스트 완료 | 1. Save Report 클릭 | 리포트 파일 생성 | MEDIUM |
| TC-UI-070 | Setup Checklist 실행 | Dashboard 탭 | 1. Run Check 클릭 | 체크리스트 항목별 결과 | HIGH |
| TC-UI-071 | Connection Timeline | Dashboard 탭 | 1. 타임라인 확인 | 연결 이벤트 시간순 표시 | MEDIUM |
| TC-UI-072 | Connection Timeline 초기화 | 타임라인 있음 | 1. Clear 클릭 | 타임라인 비움 | LOW |
| TC-UI-073 | Recent Actions | Dashboard 탭 | 1. 최근 액션 확인 | 역시간순 표시 | MEDIUM |
| TC-UI-074 | Notifications 검색 | Dashboard 탭 | 1. 검색어 입력 | 필터링된 알림 표시 | MEDIUM |
| TC-UI-075 | Notifications 필터 | Dashboard 탭 | 1. 필터 선택 (warning 등) | 해당 유형만 표시 | MEDIUM |
| TC-UI-076 | Widget Config | Dashboard 탭 | 1. Widget Settings 클릭 | 위젯 표시/숨김 설정 패널 | MEDIUM |
| TC-UI-077 | Widget Config 적용 | 설정 패널 | 1. 체크박스 변경 2. Apply | 선택 위젯만 표시 | MEDIUM |
| TC-UI-078 | Dashboard Refresh | Dashboard 탭 | 1. Refresh 버튼 클릭 | 모든 위젯 데이터 갱신 | MEDIUM |
| TC-UI-079 | Work State 색상 설정 | Dashboard 탭 | 1. Colors 버튼 클릭 | 색상 설정 패널 표시 | LOW |
| TC-UI-080 | Work State 색상 저장 | 색상 설정 | 1. 색상 변경 2. Save | 변경 색상 적용 및 저장 | LOW |

### 8.7 카메라 탭

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-UI-081 | 2-Split 레이아웃 | Camera 탭 | 1. layout 2 선택 | 2개 카메라 뷰 | HIGH |
| TC-UI-082 | 4-Split 레이아웃 | Camera 탭 | 1. layout 4 선택 | 4개 카메라 뷰 | MEDIUM |
| TC-UI-083 | 카메라 선택 체크박스 | Camera 탭 | 1. cam 체크박스 토글 | 선택 카메라만 표시 | HIGH |
| TC-UI-084 | Snap All 스냅샷 | Camera 탭 | 1. Snap All 클릭 | 모든 카메라 스냅샷 저장 | MEDIUM |

### 8.8 배치 명령

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-UI-085 | 배치 명령 실행 | SSH 연결, Batch 탭 | 1. 명령어 입력 2. Run All | 순차 실행, 결과 출력 | HIGH |
| TC-UI-086 | 배치 명령 중단 | 실행 중 | 1. Abort 클릭 | 실행 중단 | HIGH |
| TC-UI-087 | 다중 줄 명령 | Batch 탭 | 1. 여러 줄 명령 입력 2. Run All | 각 줄 순차 실행 | MEDIUM |
| TC-UI-088 | 실행 결과 출력 | 실행 완료 | 1. batch-output 확인 | 명령별 stdout/stderr 표시 | MEDIUM |

### 8.9 Jog Control 패널

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-UI-089 | Jog 패널 열기 | 로그인 상태 | 1. Jog 버튼 클릭 | Jog 패널 표시 | HIGH |
| TC-UI-090 | Jog 패널 닫기 | Jog 열림 | 1. X 버튼 클릭 | Jog 패널 닫힘 | MEDIUM |
| TC-UI-091 | 전진 (W / ↑) | Jog 열림, ROS 연결 | 1. ↑ 버튼 또는 W 키 | 로봇 전진, cmd_vel 발행 | CRITICAL |
| TC-UI-092 | 후진 (X / ↓) | Jog 열림, ROS 연결 | 1. ↓ 버튼 또는 X 키 | 로봇 후진 | CRITICAL |
| TC-UI-093 | 좌회전 (A / ←) | Jog 열림, ROS 연결 | 1. ← 버튼 또는 A 키 | 로봇 좌회전 | CRITICAL |
| TC-UI-094 | 우회전 (D / →) | Jog 열림, ROS 연결 | 1. → 버튼 또는 D 키 | 로봇 우회전 | CRITICAL |
| TC-UI-095 | 정지 (S / STOP) | Jog 열림, 이동 중 | 1. STOP 버튼 또는 S 키 | 즉시 정지 | CRITICAL |
| TC-UI-096 | 선속도 조절 | Jog 열림 | 1. linear speed 슬라이더 변경 | 이동 속도 변경 | HIGH |
| TC-UI-097 | 각속도 조절 | Jog 열림 | 1. angular speed 슬라이더 변경 | 회전 속도 변경 | HIGH |
| TC-UI-098 | Jog 토픽 변경 | Jog 열림 | 1. jog-topic 입력 변경 | 다른 토픽으로 cmd_vel 발행 | MEDIUM |
| TC-UI-099 | Jog 상태 표시 | Jog 열림 | 1. Lx/Az/Pub 상태 확인 | 현재 속도/발행 상태 표시 | LOW |

### 8.10 Quick Commands 패널

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-UI-100 | Quick Commands 열기 | 로그인 상태 | 1. Cmd 버튼 클릭 | 명령 패널 표시 | HIGH |
| TC-UI-101 | Quick Commands 닫기 | 패널 열림 | 1. X 버튼 클릭 | 패널 닫힘 | MEDIUM |
| TC-UI-102 | Restart Scorpion 명령 | 패널 열림 | 1. Restart Scorpion 클릭 | SSH 명령 실행, 결과 표시 | HIGH |
| TC-UI-103 | ROS Status 명령 | 패널 열림 | 1. ROS Status 클릭 | ROS 상태 조회 결과 | HIGH |
| TC-UI-104 | System Info 명령 | 패널 열림 | 1. System Info 클릭 | 시스템 정보 표시 | MEDIUM |
| TC-UI-105 | Disk Usage 명령 | 패널 열림 | 1. Disk Usage 클릭 | 디스크 사용량 표시 | MEDIUM |
| TC-UI-106 | Network Info 명령 | 패널 열림 | 1. Network Info 클릭 | 네트워크 정보 표시 | MEDIUM |
| TC-UI-107 | Reboot Robot 명령 | 패널 열림 | 1. Reboot Robot 클릭 | 리부트 확인 → 실행 | HIGH |
| TC-UI-108 | Camera Serial Check | 패널 열림 | 1. Check Serial 클릭 | 카메라 시리얼 비교 표시 | MEDIUM |
| TC-UI-109 | Snippet 추가 | 패널 열림 | 1. +Add 클릭 2. 이름/명령 입력 3. Save | 커스텀 명령 저장 | MEDIUM |
| TC-UI-110 | Snippet 실행 | Snippet 있음 | 1. Snippet 클릭 | 명령 실행, 결과 표시 | MEDIUM |
| TC-UI-111 | Snippet 삭제 | Snippet 있음 | 1. 삭제 버튼 클릭 | Snippet 제거 | LOW |

### 8.11 모달/다이얼로그 공통

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-UI-112 | 모달 ESC 닫기 | 모달 열림 | 1. ESC 키 | 모달 닫힘 | MEDIUM |
| TC-UI-113 | 모달 배경 클릭 닫기 | 모달 열림 | 1. 배경(오버레이) 클릭 | 모달 닫힘 | MEDIUM |
| TC-UI-114 | 모달 X 버튼 닫기 | 모달 열림 | 1. X 버튼 클릭 | 모달 닫힘 | HIGH |
| TC-UI-115 | 모달 중복 열기 방지 | 모달 열림 | 1. 다른 모달 열기 시도 | 기존 모달 닫힌 후 새 모달 또는 차단 | MEDIUM |

### 8.12 Toast 알림

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-UI-116 | Info Toast | 정보 이벤트 | 1. 토스트 확인 | 파란색 Info 토스트 표시 | MEDIUM |
| TC-UI-117 | Success Toast | 성공 이벤트 | 1. 토스트 확인 | 초록색 Success 토스트 표시 | MEDIUM |
| TC-UI-118 | Warning Toast | 경고 이벤트 | 1. 토스트 확인 | 노란색 Warning 토스트 표시 | MEDIUM |
| TC-UI-119 | Error Toast | 에러 이벤트 | 1. 토스트 확인 | 빨간색 Error 토스트 표시 | HIGH |
| TC-UI-120 | Toast 자동 사라짐 | 토스트 표시 | 1. 3.2초 대기 | 자동 fade-out | MEDIUM |
| TC-UI-121 | 다중 Toast 스택 | 여러 이벤트 | 1. 연속 이벤트 발생 | 토스트 위로 스택 | LOW |

### 8.13 이벤트 로그 패널

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-UI-122 | 이벤트 로그 열기 | 로그인 상태 | 1. Event Log 버튼 클릭 | 슬라이드 패널 표시 | MEDIUM |
| TC-UI-123 | 이벤트 로그 필터 | 패널 열림 | 1. 필터 선택 (error) | 에러 이벤트만 표시 | MEDIUM |
| TC-UI-124 | 이벤트 로그 클리어 | 로그 있음 | 1. Clear 클릭 | 로그 비움 | LOW |
| TC-UI-125 | 이벤트 로그 닫기 | 패널 열림 | 1. Close 클릭 | 패널 닫힘 | LOW |

### 8.14 키보드 단축키

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-UI-126 | 숫자키 탭 전환 (1~9) | 로그인 상태 | 1. 숫자키 입력 | 해당 탭으로 전환 | MEDIUM |
| TC-UI-127 | Space 비상 정지 | 로봇 이동 중 | 1. Space 키 | 즉시 정지 | CRITICAL |
| TC-UI-128 | Enter 액션 전송 | Tasks 탭 | 1. Enter 키 | 액션 전송 | MEDIUM |
| TC-UI-129 | ? 단축키 도움말 | 로그인 상태 | 1. ? 키 | 단축키 오버레이 표시 | LOW |
| TC-UI-130 | Ctrl+Z Undo | Tasks 탭 | 1. Ctrl+Z | 실행 취소 | MEDIUM |
| TC-UI-131 | Ctrl+Y Redo | Tasks 탭, Undo 후 | 1. Ctrl+Y | 다시 실행 | MEDIUM |

---

## SECTION 9: 고급 기능 (120건)

### 9.1 Action Sender

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-ADV-001 | 액션 타입 선택 | Tasks 탭 | 1. action-type 변경 | 선택 타입 파라미터 UI 표시 | CRITICAL |
| TC-ADV-002 | Way_Point 액션 | Tasks 탭 | 1. 0x01 선택 2. 파라미터 입력 3. Send | WayPoint 액션 발행 | CRITICAL |
| TC-ADV-003 | Docking 액션 | Tasks 탭 | 1. 0x08 선택 2. Send | 도킹 액션 발행 | HIGH |
| TC-ADV-004 | DockingOut 액션 | Tasks 탭 | 1. 0x10 선택 2. Send | 도킹아웃 액션 발행 | HIGH |
| TC-ADV-005 | 액션 취소 | 액션 실행 중 | 1. Cancel 클릭 | 실행 중인 액션 취소 | HIGH |
| TC-ADV-006 | 액션 결과 표시 | 액션 완료 | 1. action-result 확인 | 성공/실패 결과 표시 | HIGH |
| TC-ADV-007 | Task ID 설정 | Tasks 탭 | 1. action-work-id 입력 | 커스텀 Task ID 적용 | MEDIUM |
| TC-ADV-008 | Loop Count 설정 | Tasks 탭 | 1. action-loop-count 입력 (5) | 5회 반복 실행 | MEDIUM |
| TC-ADV-009 | 공통 파라미터 접기/펴기 | Tasks 탭 | 1. common-params-toggle 클릭 | 접기/펴기 토글 | LOW |

### 9.2 Action Queue

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-ADV-010 | 큐에 추가 | Tasks 탭, 파라미터 입력 | 1. Add to Queue 클릭 | 큐 목록에 액션 추가 | HIGH |
| TC-ADV-011 | 큐 순서 변경 | 큐에 2+ 액션 | 1. 드래그&드롭 | 순서 변경 | MEDIUM |
| TC-ADV-012 | 큐 항목 삭제 | 큐에 액션 있음 | 1. 항목 삭제 버튼 | 해당 항목 제거 | MEDIUM |
| TC-ADV-013 | 큐 전체 비우기 | 큐에 액션 있음 | 1. Clear Queue 클릭 | 큐 전체 비움 | MEDIUM |
| TC-ADV-014 | 큐 저장 | 큐에 액션 있음 | 1. 이름 입력 2. Save 클릭 | 큐 저장 | HIGH |
| TC-ADV-015 | 큐 로드 | 저장된 큐 있음 | 1. 큐 선택 2. Load 클릭 | 저장된 큐 복원 | HIGH |
| TC-ADV-016 | 큐 삭제 | 저장된 큐 있음 | 1. 큐 선택 2. Delete 클릭 | 저장된 큐 삭제 | MEDIUM |
| TC-ADV-017 | 큐 내보내기 | 큐에 액션 있음 | 1. Export 클릭 | JSON 파일 다운로드 | MEDIUM |
| TC-ADV-018 | 큐 가져오기 | JSON 파일 준비 | 1. Import 클릭 2. 파일 선택 | 큐에 액션 로드 | MEDIUM |
| TC-ADV-019 | Undo 동작 | 큐 조작 후 | 1. btn-undo 클릭 | 이전 상태로 복원 | MEDIUM |
| TC-ADV-020 | Redo 동작 | Undo 후 | 1. btn-redo 클릭 | 다시 실행 | MEDIUM |

### 9.3 Action Favorites & Presets

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-ADV-021 | 즐겨찾기 저장 | Tasks 탭 | 1. 파라미터 설정 2. +Save | 즐겨찾기에 저장 | MEDIUM |
| TC-ADV-022 | 즐겨찾기 불러오기 | 즐겨찾기 있음 | 1. 즐겨찾기 항목 클릭 | 파라미터 자동 입력 | MEDIUM |
| TC-ADV-023 | 프리셋 저장 | Tasks 탭 | 1. Save Current 클릭 | 파라미터 프리셋 저장 | MEDIUM |
| TC-ADV-024 | 프리셋 적용 | 프리셋 있음 | 1. 프리셋 선택 2. Apply | 파라미터 자동 설정 | MEDIUM |
| TC-ADV-025 | 프리셋 삭제 | 프리셋 있음 | 1. Delete 클릭 | 프리셋 삭제 | LOW |
| TC-ADV-026 | 액션 히스토리 표시 | 액션 실행 후 | 1. 히스토리 확인 | 실행 이력 표시 | MEDIUM |
| TC-ADV-027 | 액션 히스토리 클리어 | 히스토리 있음 | 1. Clear 클릭 | 히스토리 비움 | LOW |

### 9.4 Docking Test

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-ADV-028 | 도킹 테스트 시작 (Timer) | Docking 탭 | 1. Timer 모드 선택 2. Start | 도킹 테스트 시작 | CRITICAL |
| TC-ADV-029 | 도킹 테스트 시작 (Precision) | Docking 탭 | 1. Precision 모드 2. Start | 정밀도 테스트 시작 | CRITICAL |
| TC-ADV-030 | 도킹 타입 선택 | Docking 탭 | 1. docking-type 변경 | 선택 타입 파라미터 표시 | HIGH |
| TC-ADV-031 | 사이클 카운트 설정 | Docking 탭 | 1. cycle-count 입력 (1-100) | 설정 횟수만큼 반복 | HIGH |
| TC-ADV-032 | 도킹 테스트 중지 | 테스트 실행 중 | 1. Stop 클릭 | 테스트 중단 | HIGH |
| TC-ADV-033 | 진행률 표시 | 테스트 실행 중 | 1. progress 확인 | 현재 사이클/전체 표시 | MEDIUM |
| TC-ADV-034 | Dock In 통계 | 테스트 완료 | 1. 통계 확인 | Avg/Max/Min/3-Sigma 표시 | HIGH |
| TC-ADV-035 | Dock Out 통계 | 테스트 완료 | 1. 통계 확인 | Avg/Max/Min/3-Sigma 표시 | HIGH |
| TC-ADV-036 | 도킹 로그 표시 | 테스트 중 | 1. docking-log 확인 | 실시간 로그 출력 | MEDIUM |
| TC-ADV-037 | CSV 내보내기 | 테스트 완료 | 1. Export CSV 클릭 | 결과 CSV 다운로드 | HIGH |
| TC-ADV-038 | 도킹 방향 설정 | Docking 탭 | 1. Forward/Backward 선택 | 도킹 방향 적용 | MEDIUM |
| TC-ADV-039 | Charge 요청 설정 | Docking 탭 | 1. dock-arg-charge 변경 | 충전 요청 파라미터 적용 | MEDIUM |

### 9.5 OptiTrack 연동

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-ADV-040 | OptiTrack 연결 | Docking 탭 | 1. IP 입력 2. Connect | OptiTrack 서버 연결 | HIGH |
| TC-ADV-041 | OptiTrack 스캔 | Docking 탭 | 1. Scan 클릭 | 서버 탐지 | MEDIUM |
| TC-ADV-042 | Rigid Body 선택 | OptiTrack 연결 | 1. rigid-body 선택 | 추적 대상 설정 | HIGH |
| TC-ADV-043 | Reference 설정 | OptiTrack 연결 | 1. reference 선택 2. Set Reference | 기준점 설정 | HIGH |
| TC-ADV-044 | 위치 데이터 표시 | OptiTrack 연결 | 1. 데이터 패널 확인 | X/Y/Z 좌표 실시간 표시 | HIGH |
| TC-ADV-045 | 방향 데이터 표시 | OptiTrack 연결 | 1. 데이터 패널 확인 | Roll/Pitch/Yaw 표시 | HIGH |
| TC-ADV-046 | 정밀도 오차 표시 | Precision 테스트 중 | 1. precision 패널 확인 | X/Y/Yaw Error, Distance 표시 | HIGH |

### 9.6 Cluster Graph

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-ADV-047 | X-Y 산점도 표시 | OptiTrack 데이터 | 1. graph-xy 캔버스 확인 | 위치 분포 산점도 | HIGH |
| TC-ADV-048 | Yaw 시계열 그래프 | OptiTrack 데이터 | 1. graph-yaw 캔버스 확인 | Yaw 시계열 그래프 | HIGH |
| TC-ADV-049 | 통계값 표시 (X-Y) | 데이터 수집 중 | 1. 통계 확인 | Count, Mean, 3σ 표시 | MEDIUM |
| TC-ADV-050 | 통계값 표시 (Yaw) | 데이터 수집 중 | 1. 통계 확인 | Count, Mean, 3σ 표시 | MEDIUM |
| TC-ADV-051 | 그래프 클리어 | 데이터 있음 | 1. Clear 클릭 | 그래프 초기화 | LOW |
| TC-ADV-052 | 그래프 스냅샷 | 그래프 있음 | 1. Snapshot 클릭 | 이미지 저장 | MEDIUM |
| TC-ADV-053 | 최대 포인트 설정 | Docking 탭 | 1. graph-max-points 변경 | 최대 포인트 수 제한 | LOW |
| TC-ADV-054 | 스케일 설정 | Docking 탭 | 1. graph-scale 변경 | 그래프 스케일 변경 | LOW |

### 9.7 Map File Manager

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-ADV-055 | 맵 파일 목록 | ROS 연결 | 1. btn-map-manager 클릭 | 맵 파일 목록 표시 | HIGH |
| TC-ADV-056 | 맵 업로드 | 맵 매니저 열림 | 1. 맵 파일 업로드 | 맵 파일 저장 | HIGH |
| TC-ADV-057 | 맵 다운로드 | 맵 목록 | 1. 맵 다운로드 | 맵 파일 다운로드 | HIGH |
| TC-ADV-058 | 맵 전환 (Switch) | 맵 목록 | 1. 다른 맵 선택 2. Apply | 활성 맵 변경 | CRITICAL |
| TC-ADV-059 | 맵 삭제 | 맵 목록 | 1. 맵 삭제 | 맵 파일 삭제 | MEDIUM |

### 9.8 Map Version Control

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-ADV-060 | 버전 히스토리 표시 | 맵 편집 이력 | 1. btn-map-version 클릭 | 버전 목록 표시 | HIGH |
| TC-ADV-061 | 이전 버전 복원 | 버전 있음 | 1. 버전 선택 2. Rollback | 이전 맵 복원 | HIGH |
| TC-ADV-062 | 현재 버전 저장 | 맵 수정 후 | 1. 저장 | 새 버전으로 저장 | HIGH |

### 9.9 Map Edit

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-ADV-063 | 맵 에딧 모드 진입 | 맵 표시 중 | 1. Edit Map 토글 | 에딧 도구 표시 | HIGH |
| TC-ADV-064 | Obstacle 도구 | 에딧 모드 | 1. obstacle 선택 2. 맵에 그리기 | 장애물 영역 그리기 | HIGH |
| TC-ADV-065 | Free 도구 | 에딧 모드 | 1. free 선택 2. 맵에 그리기 | 빈 영역 그리기 | HIGH |
| TC-ADV-066 | Unknown 도구 | 에딧 모드 | 1. unknown 선택 2. 맵에 그리기 | 미지 영역 그리기 | MEDIUM |
| TC-ADV-067 | 브러시 크기 조절 | 에딧 모드 | 1. brush-size 슬라이더 변경 | 브러시 크기 변경 | MEDIUM |
| TC-ADV-068 | Undo 그리기 | 에딧 모드, 그린 후 | 1. Undo 클릭 | 마지막 그리기 취소 | MEDIUM |
| TC-ADV-069 | Reset 원본 복원 | 에딧 모드 | 1. Restore 클릭 | 원본 맵으로 복원 | MEDIUM |
| TC-ADV-070 | 맵 에딧 저장 | 에딧 후 | 1. Save 클릭 | 편집 맵 저장 | CRITICAL |
| TC-ADV-071 | 저장 후 자동 적용 | 체크박스 ON | 1. Save 클릭 | 저장 후 맵 자동 적용 | MEDIUM |
| TC-ADV-072 | 맵 에딧 취소 | 에딧 모드 | 1. Cancel 클릭 | 편집 취소, 원본 복원 | MEDIUM |

### 9.10 No-Go Zone Editor

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-ADV-073 | No-Go 패널 열기 | 맵 표시 | 1. btn-nogo-edit 클릭 | No-Go 패널 표시 | HIGH |
| TC-ADV-074 | 새 No-Go 존 추가 | 패널 열림 | 1. +New Zone 2. 맵에 점 클릭 | 다각형 영역 생성 | HIGH |
| TC-ADV-075 | No-Go 존 삭제 | 존 선택 | 1. Delete 클릭 | 선택 존 삭제 | MEDIUM |
| TC-ADV-076 | No-Go 전체 삭제 | 존 있음 | 1. Clear All 클릭 | 모든 존 삭제 | MEDIUM |
| TC-ADV-077 | No-Go 내보내기 | 존 있음 | 1. Export 클릭 | JSON 파일 다운로드 | MEDIUM |
| TC-ADV-078 | No-Go 가져오기 | JSON 파일 | 1. Import 클릭 2. 파일 선택 | 존 로드 | MEDIUM |

### 9.11 Rosbag Control

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-ADV-079 | Rosbag 패널 열기 | ROS Control 탭 | 1. btn-rosbag 클릭 | Rosbag 패널 표시 | HIGH |
| TC-ADV-080 | 녹화 시작 | Rosbag 패널 | 1. 토픽 선택 2. Record 시작 | rosbag record 실행 | HIGH |
| TC-ADV-081 | 녹화 종료 | 녹화 중 | 1. Stop 클릭 | 녹화 종료, 파일 저장 | HIGH |
| TC-ADV-082 | 재생 시작 | bag 파일 있음 | 1. 파일 선택 2. Play | rosbag play 실행 | HIGH |
| TC-ADV-083 | 재생 속도 조절 | 재생 중 | 1. 속도 변경 (0.5x, 2x) | 재생 속도 변경 | MEDIUM |
| TC-ADV-084 | Bag 파일 목록 | Rosbag 패널 | 1. 목록 확인 | 저장된 bag 파일 표시 | MEDIUM |

### 9.12 Parameter Tuning

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-ADV-085 | 파라미터 튜닝 열기 | ROS Control 탭 | 1. btn-param-tuning 클릭 | 파라미터 튜닝 UI 표시 | HIGH |
| TC-ADV-086 | 파라미터 로드 | 튜닝 UI | 1. 파라미터 그룹 로드 | 파라미터 목록 + 값 표시 | HIGH |
| TC-ADV-087 | 파라미터 수정 | 파라미터 로드 | 1. 값 변경 2. Apply | ROS 파라미터 변경 | HIGH |
| TC-ADV-088 | 파라미터 검색 | 파라미터 로드 | 1. 검색어 입력 | 매칭 파라미터만 표시 | MEDIUM |

### 9.13 Health Check / Diagnostic / Alarm

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-ADV-089 | Health Check 실행 | 로그인 상태 | 1. Health Check 열기 2. Run | 진단 결과 표시 | HIGH |
| TC-ADV-090 | Health Check 결과 | 실행 완료 | 1. 결과 확인 | pass/fail/warning 항목별 | HIGH |
| TC-ADV-091 | Diagnostic Tree 표시 | 로그인 상태 | 1. btn-diagnostic 클릭 | 계층 구조 진단 트리 | MEDIUM |
| TC-ADV-092 | Error Code 검색 | Error Code DB 열기 | 1. error-code-search 입력 | 매칭 에러코드 표시 | MEDIUM |
| TC-ADV-093 | Custom Error Code 추가 | Error Code DB | 1. +Add Custom 클릭 2. 입력 | 커스텀 코드 추가 | LOW |
| TC-ADV-094 | 알람 설정 BMS Low | Alarm Settings | 1. alarm-bms-low-en 체크 2. 값 설정 | BMS 임계값 알람 활성화 | HIGH |
| TC-ADV-095 | 알람 설정 WS Error | Alarm Settings | 1. alarm-ws-error-en 체크 2. 값 설정 | 작업상태 에러 알람 활성화 | HIGH |
| TC-ADV-096 | 알람 설정 Topic Drop | Alarm Settings | 1. alarm-topic-drop-en 체크 | 토픽 드롭 알람 활성화 | HIGH |
| TC-ADV-097 | 알람 사운드 토글 | Alarm Settings | 1. alarm-sound-en 체크 | 알람 사운드 ON | MEDIUM |
| TC-ADV-098 | Smart Alarm 규칙 추가 | Alarm Settings | 1. +Add Rule 2. 조건 설정 3. Save | 스마트 알람 규칙 저장 | MEDIUM |
| TC-ADV-099 | Smart Alarm 트리거 | 규칙 설정됨 | 1. 임계값 초과 조건 발생 | 알람 발생 (toast/sound/log) | HIGH |

### 9.14 Scheduler

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-ADV-100 | 미션 추가 | Scheduler 탭 | 1. +Add Mission 클릭 | 새 미션 추가 폼 | HIGH |
| TC-ADV-101 | 미션 실행 | 미션 등록됨 | 1. 미션 실행 | 등록 액션 순차 실행 | HIGH |
| TC-ADV-102 | 미션 전체 삭제 | 미션 있음 | 1. Clear All 클릭 | 모든 미션 삭제 | MEDIUM |
| TC-ADV-103 | 실행 로그 표시 | 미션 실행 | 1. scheduler-log 확인 | 실행 로그 출력 | MEDIUM |
| TC-ADV-104 | 실행 로그 클리어 | 로그 있음 | 1. Clear 클릭 | 로그 비움 | LOW |
| TC-ADV-105 | MANUAL/AUTO 모드 | Scheduler 탭 | 1. 모드 배지 확인 | 현재 모드 표시 | MEDIUM |

### 9.15 Monitoring

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-ADV-106 | CPU 사용률 표시 | Monitor 탭, SSH 연결 | 1. CPU 카드 확인 | 퍼센트 + 바 표시 | HIGH |
| TC-ADV-107 | 메모리 사용률 표시 | Monitor 탭 | 1. Memory 카드 확인 | 퍼센트 + 바 표시 | HIGH |
| TC-ADV-108 | 디스크 사용률 표시 | Monitor 탭 | 1. Disk 카드 확인 | 퍼센트 + 바 표시 | HIGH |
| TC-ADV-109 | CPU 온도 표시 | Monitor 탭 | 1. Temp 카드 확인 | 온도(℃) 표시 | MEDIUM |
| TC-ADV-110 | 네트워크 RX/TX | Monitor 탭 | 1. Network 카드 확인 | RX/TX KB/s 표시 | MEDIUM |
| TC-ADV-111 | Sysinfo Refresh | Monitor 탭 | 1. Refresh 클릭 | 모든 카드 갱신 | MEDIUM |
| TC-ADV-112 | Network Config 열기 | Monitor 탭 | 1. Network 버튼 클릭 | 네트워크 설정 표시 | MEDIUM |

### 9.16 Session/Audit/Incident

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-ADV-113 | 세션 내보내기 | 로그인 상태 | 1. Export Session 클릭 | JSON 파일 다운로드 | MEDIUM |
| TC-ADV-114 | 세션 가져오기 | JSON 파일 준비 | 1. Import Session 2. 파일 선택 | 세션 데이터 복원 | MEDIUM |
| TC-ADV-115 | Audit Trail 표시 | 로그인 상태 | 1. Audit Trail 클릭 | 감사 로그 표시 | MEDIUM |
| TC-ADV-116 | Audit 검색 | Audit 열림 | 1. 검색어 입력 | 매칭 항목만 표시 | LOW |
| TC-ADV-117 | Audit 필터 | Audit 열림 | 1. 필터 선택 | 해당 유형만 표시 | LOW |
| TC-ADV-118 | Audit CSV 내보내기 | Audit 열림 | 1. Export CSV 클릭 | CSV 파일 다운로드 | MEDIUM |
| TC-ADV-119 | Incident Report 생성 | 로그인 상태 | 1. Incident Report 클릭 | 리포트 생성 UI | MEDIUM |
| TC-ADV-120 | Performance Profiler | ROS Control 탭 | 1. btn-perf-profiler 클릭 | 성능 프로파일러 표시 | MEDIUM |

---

## SECTION 10: 데이터 저장 (13건)

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-STOR-001 | 탭 상태 저장 (amrActiveTab) | 탭 전환 | 1. 새로고침 | 마지막 탭 복원 | HIGH |
| TC-STOR-002 | 테마 저장 (amrTheme) | 테마 변경 | 1. 새로고침 | 테마 유지 | MEDIUM |
| TC-STOR-003 | 로봇 슬롯 저장 (amrRobotSlots) | 로봇 추가 | 1. 새로고침 | 로봇 목록 유지 | HIGH |
| TC-STOR-004 | 이벤트 로그 저장 (amrEventLog) | 이벤트 발생 | 1. 새로고침 | 이벤트 로그 유지 | MEDIUM |
| TC-STOR-005 | 이벤트 로그 최대 200건 | 200+ 이벤트 | 1. 200건 초과 확인 | 오래된 항목 자동 삭제 | MEDIUM |
| TC-STOR-006 | Audit Trail 저장 (amrAuditTrail) | 감사 이벤트 | 1. 새로고침 | Audit 유지 | MEDIUM |
| TC-STOR-007 | Audit Trail 최대 500건 | 500+ 이벤트 | 1. 500건 초과 확인 | 오래된 항목 자동 삭제 | MEDIUM |
| TC-STOR-008 | 폰트 크기 저장 (amrFontSize) | 폰트 변경 | 1. 새로고침 | 폰트 크기 유지 | LOW |
| TC-STOR-009 | robot-config.json 로드 | 서버 시작 | 1. /api/robots 호출 | 저장된 로봇 설정 로드 | HIGH |
| TC-STOR-010 | robot-config.json 저장 | 로봇 변경 | 1. 로봇 추가/삭제 | JSON 파일 업데이트 | HIGH |
| TC-STOR-011 | robot-templates.json 로드 | 서버 시작 | 1. 로봇 매니저 열기 | 템플릿 로드 | MEDIUM |
| TC-STOR-012 | localStorage 용량 초과 (B13) | 대량 데이터 | 1. 저장 시도 | 에러 감지 및 사용자 알림 | HIGH |
| TC-STOR-013 | localStorage 전체 초기화 | 초기화 필요 | 1. 초기화 실행 | 모든 amr* 키 삭제 | MEDIUM |

---

## SECTION 11: 다국어 - i18n (7건)

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-I18N-001 | 영어 번역 로드 | 언어 설정 EN | 1. 페이지 로드 | 영어 텍스트 표시 | HIGH |
| TC-I18N-002 | 한국어 번역 로드 | 언어 설정 KO | 1. 페이지 로드 | 한국어 텍스트 표시 | HIGH |
| TC-I18N-003 | 언어 동적 전환 | 로그인 상태 | 1. 언어 변경 | 페이지 새로고침 없이 전환 | HIGH |
| TC-I18N-004 | 언어 설정 저장 | 언어 변경 | 1. 새로고침 | 선택 언어 유지 | MEDIUM |
| TC-I18N-005 | 누락 키 fallback | 번역 키 없음 | 1. 미번역 키 확인 | 영어 기본값 표시 | MEDIUM |
| TC-I18N-006 | data-i18n 속성 적용 | 페이지 로드 | 1. data-i18n 엘리먼트 확인 | 모든 data-i18n 엘리먼트 번역됨 | HIGH |
| TC-I18N-007 | 날짜/시간 로케일 포맷 | 이벤트 발생 | 1. 날짜 표시 확인 | 언어에 맞는 날짜 형식 | LOW |

---

## SECTION 12: 에러 처리 & 경계값 (26건)

### 12.1 네트워크 에러

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-ERR-001 | ROS Bridge 연결 거부 | 잘못된 IP/포트 | 1. 연결 시도 | 사용자 친화적 에러 메시지 | HIGH |
| TC-ERR-002 | WebSocket 타임아웃 | 네트워크 지연 | 1. 연결 시도 | 타임아웃 메시지 | HIGH |
| TC-ERR-003 | 연결 중 네트워크 끊김 | ROS 연결 상태 | 1. 네트워크 케이블 뽑기 | 끊김 감지, 상태 업데이트 | HIGH |
| TC-ERR-004 | fetch 타임아웃 (B12) | API 호출 | 1. 응답 지연 서버 | 무한 대기 여부 확인 | HIGH |
| TC-ERR-005 | 서버 다운 시 API 호출 | 서버 종료 | 1. API 호출 시도 | 에러 메시지, 재시도 옵션 | HIGH |

### 12.2 SSH 에러

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-ERR-006 | SSH 인증 실패 | 잘못된 비밀번호 | 1. SSH 연결 | "Authentication failed" 메시지 | HIGH |
| TC-ERR-007 | SSH 명령 not found | SSH 연결 | 1. 존재하지 않는 명령 실행 | stderr 출력, exitCode != 0 | MEDIUM |
| TC-ERR-008 | SSH Permission denied | SSH 연결 | 1. 권한 없는 작업 실행 | 에러 메시지 표시 | MEDIUM |
| TC-ERR-009 | SSH exec 타임아웃 (B2) | SSH 세션 | 1. 무한 루프 명령 실행 | 타임아웃 처리 여부 확인 | CRITICAL |

### 12.3 입력 유효성

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-ERR-010 | IP 주소 형식 검증 | 입력 필드 | 1. "999.999.999.999" 입력 | 유효성 에러 | HIGH |
| TC-ERR-011 | 포트 범위 검증 | 입력 필드 | 1. 0 또는 70000 입력 | 범위 에러 (1-65535) | HIGH |
| TC-ERR-012 | 필수 필드 빈 값 | 입력 폼 | 1. 필수 필드 비움 2. Submit | 필수 입력 안내 | MEDIUM |
| TC-ERR-013 | 특수문자 입력 | 텍스트 필드 | 1. <script>alert(1)</script> 입력 | XSS 방지 (S3) | CRITICAL |
| TC-ERR-014 | JSON 파라미터 유효성 | 서비스 인자 필드 | 1. 잘못된 JSON 입력 | JSON 파싱 에러 메시지 | MEDIUM |

### 12.4 경계값

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-ERR-015 | 빈 노드 목록 | ROS 연결, 노드 없음 | 1. 노드 목록 확인 | "No nodes" 또는 빈 목록 | MEDIUM |
| TC-ERR-016 | 빈 토픽 목록 | ROS 연결, 토픽 없음 | 1. 토픽 목록 확인 | "No topics" 또는 빈 목록 | MEDIUM |
| TC-ERR-017 | 1000+ 노드 | 대량 노드 | 1. 노드 목록 로드 | 렌더링 성능 유지 | MEDIUM |
| TC-ERR-018 | 8192자 초과 SSH 명령 | SSH 연결 | 1. 8193자 명령 전송 | 길이 제한 에러 | HIGH |
| TC-ERR-019 | 맵 없는 상태에서 맵 에딧 | 맵 미수신 | 1. Edit Map 클릭 | 에러 또는 비활성 | MEDIUM |
| TC-ERR-020 | 로봇 미연결 액션 전송 | 미연결 | 1. Send Goal 클릭 | 연결 필요 안내 | HIGH |
| TC-ERR-021 | 동시 SLAM + Lifelong | SLAM 실행 중 | 1. Lifelong 시작 시도 | 상호 배타 동작 | HIGH |
| TC-ERR-022 | 페이지 새로고침 중 cleanup | ROS 연결, 구독 활성 | 1. F5 새로고침 | 구독/타이머 정리 (B15) | HIGH |
| TC-ERR-023 | 빠른 연결/해제 반복 (B8) | 로봇 등록 | 1. 연결→해제 빠르게 반복 | Race condition 없음 | HIGH |
| TC-ERR-024 | 수동+자동 재연결 동시 (B9) | 자동 재연결 ON | 1. 끊김 후 수동 재연결 | 중복 연결 방지 | HIGH |
| TC-ERR-025 | addEventListener 누수 (B6) | 장시간 사용 | 1. 탭 전환 100회 | 메모리 사용량 안정 | HIGH |
| TC-ERR-026 | setInterval 미정리 (B7) | disconnect 후 | 1. 연결/해제 반복 | 잔존 타이머 없음 확인 | HIGH |

---

## SECTION 13: 보안 (15건)

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-SEC-001 | SSH 비밀번호 평문 저장 (S1) | 로봇 등록 | 1. DevTools > Application > localStorage | 평문 저장 여부 확인 | CRITICAL |
| TC-SEC-002 | 터널 명령 인젝션 (S2) | 터널 모드 | 1. IP에 "; cat /etc/passwd" 삽입 | 입력 소독 확인 | CRITICAL |
| TC-SEC-003 | innerHTML XSS (S3) | - | 1. 사용자 입력에 HTML 삽입 | 스크립트 실행 차단 | CRITICAL |
| TC-SEC-004 | sshpass 프로세스 노출 (S4) | 터널 활성 | 1. `ps aux | grep sshpass` | 비밀번호 노출 여부 | HIGH |
| TC-SEC-005 | HTTP 트래픽 스니핑 (S5) | HTTP 모드 | 1. Wireshark로 패킷 캡처 | 비밀번호 평문 전송 여부 | HIGH |
| TC-SEC-006 | 세션 무한 유지 (S6) | 로그인 | 1. 24시간 방치 | 세션 타임아웃 여부 확인 | MEDIUM |
| TC-SEC-007 | CSRF 보호 (S7) | 로그인 | 1. 외부 사이트에서 API 호출 | CSRF 토큰 검증 여부 | MEDIUM |
| TC-SEC-008 | testmode 원격 접근 | 외부 IP | 1. 외부에서 /api/testmode/start | 127.0.0.1 제한 | CRITICAL |
| TC-SEC-009 | SSH exec 명령 검증 | SSH 세션 | 1. 위험 명령 전송 (rm -rf /) | 검증 또는 경고 | HIGH |
| TC-SEC-010 | SFTP 경로 탐색 | SFTP 세션 | 1. "../../etc/shadow" 다운로드 시도 | 경로 탐색 차단 | CRITICAL |
| TC-SEC-011 | 세션 토큰 HttpOnly | 로그인 | 1. document.cookie 확인 | HttpOnly 플래그 확인 | HIGH |
| TC-SEC-012 | 인증 없는 WebSocket | 미인증 | 1. ws:// 직접 연결 | 인증 필요 (B10) | HIGH |
| TC-SEC-013 | 입력 길이 제한 | 각 입력 필드 | 1. 각 필드 최대길이 초과 입력 | maxlength/서버 검증 | MEDIUM |
| TC-SEC-014 | 민감 정보 로깅 방지 | 콘솔/로그 | 1. console.log 확인 | 비밀번호 로깅 없음 | HIGH |
| TC-SEC-015 | Content-Security-Policy | 페이지 로드 | 1. CSP 헤더 확인 | 적절한 CSP 설정 | MEDIUM |

---

## SECTION 14: 성능 (14건)

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-PERF-001 | 초기 페이지 로드 시간 | 서버 실행 | 1. 페이지 최초 로드 | < 3초 | HIGH |
| TC-PERF-002 | 탭 전환 반응 시간 | 로그인 상태 | 1. 탭 클릭 | < 100ms | MEDIUM |
| TC-PERF-003 | 맵 렌더링 FPS | 맵 + LiDAR 활성 | 1. FPS 측정 | ≥ 30 FPS | HIGH |
| TC-PERF-004 | LiDAR 1000+ 포인트 (P2) | LiDAR 활성 | 1. 1000+ 포인트 수신 | 렌더링 지연 확인 | HIGH |
| TC-PERF-005 | 캔버스 resize 깜빡임 (P1) | 맵 표시 | 1. 매 렌더 사이클 확인 | 깜빡임 여부 | MEDIUM |
| TC-PERF-006 | 33개 JS 파일 로딩 (P3) | 페이지 로드 | 1. Network 탭 확인 | 33개 개별 요청 성능 영향 | MEDIUM |
| TC-PERF-007 | 메모리 사용량 안정성 | 1시간 사용 | 1. 메모리 추이 모니터링 | 메모리 누수 없음 | HIGH |
| TC-PERF-008 | SSH 명령 응답 시간 | SSH 연결 | 1. 간단 명령 실행 | < 1초 | MEDIUM |
| TC-PERF-009 | SFTP 파일 목록 응답 | SSH 연결 | 1. 1000개 파일 디렉토리 탐색 | < 2초 | MEDIUM |
| TC-PERF-010 | 서브넷 스캔 시간 | 로봇 매니저 | 1. /24 서브넷 스캔 | < 15초 | MEDIUM |
| TC-PERF-011 | 다중 로봇 (10대) 동시 연결 | 10대 등록 | 1. 10대 동시 연결 | UI 반응성 유지 | HIGH |
| TC-PERF-012 | 토픽 100msg/s 처리 | 고빈도 토픽 | 1. 100Hz 토픽 구독 | 메시지 드롭 확인 | MEDIUM |
| TC-PERF-013 | 이벤트 루프 블로킹 (P6) | SSH+파일+WS 동시 | 1. 동시 작업 실행 | 응답 지연 확인 | HIGH |
| TC-PERF-014 | gzip 압축 (P4) | API 응답 | 1. Response headers 확인 | Content-Encoding: gzip 여부 | MEDIUM |

---

## SECTION 15: 접근성 (14건)

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-A11Y-001 | Tab 키 네비게이션 | 로그인 화면 | 1. Tab 키로 이동 | 논리적 순서로 포커스 이동 | MEDIUM |
| TC-A11Y-002 | Enter/Space 버튼 활성화 | 버튼 포커스 | 1. Enter 또는 Space 키 | 버튼 동작 실행 | MEDIUM |
| TC-A11Y-003 | 폼 필드 Tab 이동 | 입력 폼 | 1. Tab 키로 이동 | 모든 필드 접근 가능 | MEDIUM |
| TC-A11Y-004 | 키보드 단축키 동작 | 로그인 상태 | 1. 각 단축키 테스트 | 모든 단축키 정상 | MEDIUM |
| TC-A11Y-005 | 포커스 인디케이터 (U10) | 각 요소 | 1. Tab으로 포커스 | 포커스 표시 여부 확인 | MEDIUM |
| TC-A11Y-006 | ARIA 라벨 존재 | 아이콘 버튼 | 1. aria-label 확인 | 텍스트 없는 버튼에 label 존재 | MEDIUM |
| TC-A11Y-007 | 동적 콘텐츠 알림 | 토스트/알람 | 1. aria-live 확인 | aria-live="polite" 설정 | LOW |
| TC-A11Y-008 | 색상 대비 (다크 모드) | 다크 모드 | 1. 텍스트 대비 확인 | WCAG AA (4.5:1) 이상 | MEDIUM |
| TC-A11Y-009 | 색상 대비 (라이트 모드) | 라이트 모드 | 1. 텍스트 대비 확인 | WCAG AA (4.5:1) 이상 | MEDIUM |
| TC-A11Y-010 | 색상만 의존 안 함 | 상태 표시 | 1. 아이콘+색상 확인 | 색상 외 아이콘/텍스트 구분 | MEDIUM |
| TC-A11Y-011 | 모바일 터치 타겟 | 모바일 브라우저 | 1. 터치 영역 확인 | 최소 44px × 44px | LOW |
| TC-A11Y-012 | 반응형 레이아웃 (1200px+) | 데스크탑 | 1. 1920px 해상도 | 정상 레이아웃 | HIGH |
| TC-A11Y-013 | 반응형 레이아웃 (768px) | 태블릿 | 1. 768px 리사이즈 | 맵 패널 조정 | MEDIUM |
| TC-A11Y-014 | 반응형 레이아웃 (375px) | 모바일 | 1. 375px 리사이즈 | 모바일 레이아웃 | LOW |

---

## SECTION 16: 브라우저 호환성 (10건)

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-COMPAT-001 | Chrome 최신 버전 | Chrome 90+ | 1. 전체 기능 테스트 | 정상 동작 | CRITICAL |
| TC-COMPAT-002 | Firefox 최신 버전 | Firefox 88+ | 1. 전체 기능 테스트 | 정상 동작 | HIGH |
| TC-COMPAT-003 | Edge 최신 버전 | Edge 90+ | 1. 전체 기능 테스트 | 정상 동작 | HIGH |
| TC-COMPAT-004 | Safari 최신 버전 | Safari 14+ | 1. 전체 기능 테스트 | 정상 동작 | MEDIUM |
| TC-COMPAT-005 | WebSocket 호환성 | 각 브라우저 | 1. ROS Bridge 연결 | 모든 브라우저 정상 | CRITICAL |
| TC-COMPAT-006 | xterm.js 호환성 | 각 브라우저 | 1. SSH 터미널 사용 | 렌더링 정상 | HIGH |
| TC-COMPAT-007 | Canvas 렌더링 | 각 브라우저 | 1. 맵/그래프 표시 | 정상 렌더링 | HIGH |
| TC-COMPAT-008 | localStorage 지원 | 각 브라우저 | 1. 설정 저장/로드 | 정상 동작 | HIGH |
| TC-COMPAT-009 | CSS Grid/Flexbox | 각 브라우저 | 1. 레이아웃 확인 | 정상 렌더링 | MEDIUM |
| TC-COMPAT-010 | 콘솔 에러 없음 | 각 브라우저 | 1. DevTools 콘솔 확인 | JS 에러 없음 | MEDIUM |

---

## SECTION 17: Rate Limiting (5건)

| TC ID | 제목 | 사전조건 | 테스트 단계 | 기대결과 | 심각도 |
|-------|------|----------|-------------|----------|--------|
| TC-RATE-001 | 인증 Rate Limit (5회/60초) | 서버 실행 | 1. 60초 내 6회 로그인 | 6번째 429 응답 | HIGH |
| TC-RATE-002 | 명령 Rate Limit (60회/60초) | SSH 세션 | 1. 60초 내 61회 exec | 61번째 429 응답 | HIGH |
| TC-RATE-003 | Rate Limit 윈도우 리셋 | Rate Limit 도달 | 1. 60초 대기 2. 재시도 | 정상 응답 | MEDIUM |
| TC-RATE-004 | IP별 독립 카운팅 | 다른 IP 2개 | 1. IP-A 한도 도달 2. IP-B 시도 | IP-B 정상 | MEDIUM |
| TC-RATE-005 | Stale 세션 정리 | 장시간 경과 | 1. cleanup 주기 대기 | 만료 세션 자동 제거 | LOW |

---

## 부록: TC 매트릭스 요약

| 섹션 | 카테고리 | CRITICAL | HIGH | MEDIUM | LOW | 합계 |
|------|----------|----------|------|--------|-----|------|
| 1 | 인증 & 세션 | 5 | 6 | 6 | 3 | 20 |
| 2 | 로봇 관리 | 2 | 16 | 18 | 4 | 40 |
| 3 | SSH / 터미널 | 7 | 16 | 14 | 9 | 46 |
| 4 | 파일 전송 | 5 | 13 | 14 | 10 | 42 |
| 5 | 터널링 | 5 | 9 | 5 | 1 | 20 |
| 6 | 테스트 모드 | 7 | 7 | 8 | 2 | 24 |
| 7 | ROS 통합 | 5 | 17 | 14 | 3 | 39 |
| 8 | UI 컴포넌트 | 8 | 30 | 52 | 28 | 118 |
| 9 | 고급 기능 | 3 | 42 | 55 | 20 | 120 |
| 10 | 데이터 저장 | 0 | 5 | 6 | 2 | 13 |
| 11 | 다국어 | 0 | 4 | 2 | 1 | 7 |
| 12 | 에러 처리 | 2 | 14 | 8 | 2 | 26 |
| 13 | 보안 | 4 | 6 | 4 | 1 | 15 |
| 14 | 성능 | 0 | 5 | 8 | 1 | 14 |
| 15 | 접근성 | 0 | 1 | 10 | 3 | 14 |
| 16 | 브라우저 호환 | 2 | 5 | 3 | 0 | 10 |
| 17 | Rate Limiting | 0 | 2 | 2 | 1 | 5 |
| **합계** | | **55** | **198** | **229** | **91** | **573** |

---

## QA 실행 가이드

### 우선순위별 실행 순서

**Round 1 - Smoke Test (55건 CRITICAL)**
> 핵심 기능 정상 동작 확인. 1일 소요.
- 인증 로그인/세션 (5건)
- 로봇 연결/전환 (2건)
- SSH 연결/실행/sudo (7건)
- SFTP 업로드/다운로드 (5건)
- 터널 생성/보안 (5건)
- 테스트 모드 시작/종료/API (7건)
- ROS 연결/구독 (5건)
- 맵/Jog/NavGoal (8건)
- 도킹 테스트 시작 (3건)
- 보안 치명적 항목 (4건)
- 브라우저 호환 (2건)
- 에러 처리 (2건)

**Round 2 - Core Test (198건 HIGH)**
> 주요 기능 전체 커버. 3~5일 소요.

**Round 3 - Full Test (229건 MEDIUM)**
> 부가 기능 및 옵션 검증. 3~5일 소요.

**Round 4 - Edge & Polish (91건 LOW)**
> UI 디테일 및 경계값. 1~2일 소요.

### 테스트 환경 요구사항

| 항목 | 요구사항 |
|------|----------|
| 로봇 | ULW 시리즈 1대 이상 (실기), 또는 테스트 모드 |
| 네트워크 | 로봇과 동일 서브넷, SSH 접근 가능 |
| 브라우저 | Chrome 최신, Firefox 최신, Edge 최신 |
| OS | Ubuntu 20.04/22.04 (서버), Windows/Mac (클라이언트) |
| 추가 장비 | OptiTrack (도킹 정밀도 테스트 시) |
| 도구 | DevTools, Wireshark (보안 테스트), htop (성능 테스트) |
