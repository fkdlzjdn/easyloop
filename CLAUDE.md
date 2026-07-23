# EasyLoop - AMR 맵핑 및 현장 엔지니어 웹 툴

## 개요
AMR 로봇의 SLAM 맵핑과 루프 클로저 작업을 중심으로 현장 세팅/모니터링/진단을 지원하는 웹 애플리케이션. 폐쇄망(AP) 환경에서 동작.
Express.js 백엔드 + Vanilla JS 프론트엔드, SSH/ROS Bridge 기반.

## 기술 스택
- **백엔드**: Node.js 18+, Express 4.18, WebSocket (ws), ssh2, multer
- **프론트엔드**: Vanilla HTML/CSS/JS (36개 모듈)
- **패키징**: pkg (standalone 바이너리), Docker
- **버전**: v1.3.0

## 주요 기능 (50+)
- **ROS 연동**: 노드/토픽/서비스/파라미터 브라우저, 액션 전송, rosbag 제어
- **SSH/SFTP**: 다중 터미널, 파일 업/다운로드 (100MB), SSH 터널링
- **모니터링**: CPU/메모리/디스크, 네트워크 대역폭, 실시간 그래프
- **진단**: diagnostic tree, CAN 진단 (SDO read/write), 에러코드 DB
- **맵 관리**: 맵 파일 매니저, 버전 관리, no-go zone 편집기
- **Fleet**: 다중 로봇 대시보드, RID 기반 자동 검색(기본 `192.168.20.0/24`, 고정 `192.168.3.5`), 수동 대역 설정, 로봇 템플릿
- **설정**: 파라미터 튜닝, config diff, 백업/복원
- **기타**: 다국어(ko/en/ja/zh), 다크모드, 테스트 모드

## 프로젝트 구조
```
easyloop/
├── server.js              # Express 서버 진입점 (483줄)
├── server/
│   ├── auth.js            # JWT/쿠키 인증 (12시간 TTL)
│   ├── rate-limit.js      # Rate limiter (인증: 5/분, 명령: 60/분)
│   ├── validation.js      # 입력 검증
│   ├── ssh.js             # SSH 연결 (키→비밀번호 fallback)
│   ├── tunnel-manager.js  # SSH 포트포워딩
│   ├── robots-config.js   # 로봇 설정 파일 I/O
│   ├── routes/
│   │   ├── auth.js        # POST /auth/login, logout
│   │   ├── robots.js      # GET/POST /robots, scan
│   │   ├── ssh.js         # POST /ssh/connect, exec
│   │   ├── sftp.js        # POST /sftp/list, upload, download
│   │   ├── tunnel.js      # POST /tunnel/start, stop
│   │   └── can.js         # CAN 진단 (scan, SDO, candump)
│   └── can/               # CAN 파서, 에러코드, Syntron 파라미터
├── public/
│   ├── index.html
│   ├── js/
│   │   ├── app.js         # 메인 UI (98KB)
│   │   ├── ros-manager.js # ROS Bridge 핸들러 (149KB)
│   │   └── (34개 기능 모듈)
│   ├── css/style.css      # 라이트/다크 테마
│   └── locales/           # 다국어 파일 (ko, en, ja, zh)
├── config/
│   ├── robots.json        # 등록된 로봇 목록
│   └── robot-templates.json  # 로봇 모델 템플릿
├── dist/                  # 빌드 결과물 (.exe, 리눅스 바이너리)
└── tests/                 # Jest 테스트
```

## 개발
```bash
npm install
npm run dev          # Express 서버 (:3000)
npm run lint         # ESLint
npm test             # Jest
```

## 빌드/배포
```bash
# Standalone 바이너리
npm run build:linux  # → dist/easyloop (33MB)
npm run build:win    # → dist/EasyLoop.exe (39MB)
npm run build:all    # 둘 다 + GZip

# Docker
docker build -t easyloop .
docker run -p 3000:3000 easyloop

# 직접 실행
npm start            # 또는 ./start.sh
```

## API 엔드포인트
| 그룹 | 주요 경로 | 설명 |
|------|----------|------|
| Auth | POST /auth/login | 공유 비밀번호 인증 |
| Robots | GET /api/robots, /scan-subnet | 로봇 목록/서브넷 자동 검색 및 RID 확인 |
| SSH | POST /api/ssh/connect, /exec | SSH 연결/명령 실행 |
| SFTP | POST /api/sftp/list, /upload, /download | 파일 관리 |
| Tunnel | POST /api/tunnel/start, /stop | SSH 터널 (127.0.0.x:9090) |
| CAN | POST /api/can/scan, /sdo-read, /sdo-write | CAN 진단 |
| WebSocket | /ws | ROS Bridge 릴레이 |

## 인증
- 공유 비밀번호 방식 (`.env`의 `SHARED_PASSWORD`)
- 12시간 TTL 세션
- Rate limiting: 인증 5/분, 명령 60/분

## 저장소
- DB 없음 (파일 기반)
- 로봇 설정: `config/robots.json`
- 환경: `.env` (PORT, SHARED_PASSWORD)
- 브라우저 localStorage (세션, 설정, 히스토리)

## 로봇 템플릿
- `scorpion_v1` — 기본 플랫폼 (0.8 m/s)
- `scorpion_v2` — 리프트 장착 (1.0 m/s)
- `conveyor_bot` — 벨트 시스템 (0.6 m/s)
- `custom` — 사용자 정의
