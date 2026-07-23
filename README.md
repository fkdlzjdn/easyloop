# EasyLoop

AMR 현장 엔지니어가 SLAM 주행 궤적과 루프 클로저를 확인하며 완성도 높은 맵을 만들 수 있도록 돕는 웹 도구입니다. ROS1 + rosbridge(websocket) 기반으로 로봇 제어, 모니터링, 셋업, 진단 및 기능 검토 업무도 지원합니다.

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

브라우저에서 `http://localhost:3000` 접속

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
