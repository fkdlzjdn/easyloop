# EasyLoop

AMR 현장 엔지니어가 SLAM 주행 궤적과 루프 클로저를 확인하며 완성도 높은 맵을 만들 수 있도록 돕는 웹 도구입니다. ROS1/ROS2 rosbridge(websocket)를 통해 로봇 제어, 모니터링, 셋업, 진단 및 기능 검토 업무도 지원합니다.

## AMR runtime 호환 범위

EasyLoop는 프로젝트 Git 구조와 실제 제어 프로토콜을 분리합니다. `ROBOT_MODEL`과 프로젝트 선택은 기구/UI 힌트이며, 제어 endpoint와 type은 연결 시 `/rosapi/services`, `/rosapi/topics`, `service_type`, `topic_type`으로 검증합니다.

| Git 계보 | 프로젝트 범위 | runtime 계약 |
|---|---|---|
| Legacy `scorpion_ros` | 지정 13개 legacy project | ROS1 TARU 중심 |
| Core submodule | 지정 24개 core project | ROS1 TARU 또는 혼합 graph |
| SPX ROS1 | `sl3000_mspe`, `tt400_vri`, `template_repository`, `SR-AMR-Base` | native SPX 우선, TARU adapter 허용 |
| SPX ROS2 Jazzy | `SR-AMR-Base2` | ROS2 SPX type (`pkg/srv/Type`, `pkg/msg/Type`) |

Task, mode, map, lift, turntable, monitoring은 subsystem별로 독립 판정합니다. discovery 실패, endpoint/type 불일치, 수동 override 불일치 시 해당 제어는 비활성화됩니다. 텔레메트리 병렬 구독은 가능하지만 제어 fallback은 사용하지 않습니다.

Task/Quick Task는 연결된 scheduler의 `get_actions_info` 또는 `spx/task/actions/info`를 읽어 실제 등록된 `action_type`만 입력·실행할 수 있습니다. `basic_settings/model_type` 등 차상 파라미터를 감지해 WayPoint/Docking/Trajectory payload의 `model_type`에 반영하며, 감지 실패 시 이 세 모델 의존 Action은 실행하지 않습니다. Action 인자 개수·숫자 여부·필수 파라미터도 전송 직전에 다시 검사합니다. Legacy `Basic_Move [이동종류, 거리/각도]`와 native SPX `BasicMove [거리(mm), 속도]`의 계약 차이는 선형 이동만 명시적으로 변환하고, 호환되지 않는 회전은 전송하지 않습니다.

ROS2 `SR-AMR-Base2`는 로봇 측 ROS2 `rosbridge_server`와 `/rosapi/*`가 실제로 실행 중이어야 합니다. 없으면 EasyLoop 연결·제어가 차단되며 SSH 명령으로 우회하지 않습니다.

## 주요 기능
- ROS 노드/토픽/서비스/파라미터 조회
- SLAM/Lifelong Mapping 제어, 주행 궤적 및 루프 클로저 안내
- 로봇 관리 진입 시 `192.168.20.0/24` 자동 검색, RID 확인 및 선택 등록
- 검색 대역 수동 설정과 초기 설정 IP `192.168.3.5` 상시 탐색
- 액션 전송 및 결과 확인
- SSH 터미널 및 파일 전송(SFTP)
- 도킹 테스트(OptiTrack 포함)
- 대시보드(최근 작업/테스트 히스토리/알림)

## 요구 사항
- Node.js 18+

## 시작하기
1) 의존성 설치
```bash
npm install
```

2) 환경 변수 설정
```bash
cp .env.example .env
```
`SHARED_PASSWORD`는 공유 비밀번호로 사용됩니다.

3) 서버 실행
```bash
npm run start
```

브라우저에서 `http://localhost:3000` 또는 같은 LAN의 `http://<서버 IPv4>:3000`으로 접속합니다. 서버는 `0.0.0.0`에서 수신합니다.

### Windows 타부서 공유

- `npm run build:win`으로 `dist/EasyLoop.exe`를 생성합니다.
- `windows/EasyLoop_실행.bat`를 EXE와 같은 폴더에 둡니다.
- 배치 파일은 포트 3000을 고정하고 `192.168.30.0/24`에 한정된 Windows 방화벽 규칙을 설정합니다.
- 실행 브라우저는 `localhost` 대신 실행 PC의 `192.168.30.x:3000` 주소를 우선 사용합니다.

## 스크립트
- `npm run dev`: 개발 실행
- `npm run lint`: ESLint 실행
- `npm test`: Jest 테스트

## 보안 참고
- 폐쇄망(AP) 환경 기준이지만, 공유 비밀번호는 서버에서만 검증합니다.
- 인증/입력 검증/레이트리밋이 적용되어 있습니다.

## 폴더 구조
- `public/`: 프론트엔드(HTML/CSS/JS)
- `server/`: 서버 모듈(라우트/검증/레이트리밋/SSH)
- `config/`: 로봇 설정 파일
- `tests/`: Jest 테스트
