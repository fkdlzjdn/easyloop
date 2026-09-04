// Contextual, click-to-open usage notes for every primary EasyLoop page.
const UsageGuides = {
  guides: {
    'panel-map': {
      title: '맵 화면 사용 팁',
      intro: '로봇 위치, 센서, 경로와 Mapping 결과를 한 화면에서 확인하고 편집합니다.',
      steps: [
        '레이어에서 필요한 항목만 체크해 화면을 단순하게 유지하세요.',
        '보기를 열면 지도 위를 가리지 않는 가로 도구가 펼쳐집니다. 지도를 보면서 확대·회전·정렬을 조정하세요.',
        '목적지 주행을 시작하면 검은 장애물 셀과 로봇 안전 여유 폭을 피해 우회 경로를 생성합니다.',
        '평소에는 NAV·IDLE이며, Mapping을 시작한 동안에만 Mapping Path와 Loop Closure 안내가 표시됩니다.',
        '맵 저장 후 Mapping을 종료하면 NAV로 복귀하며, 저장된 맵이 Navigation 화면에 표시됩니다.'
      ],
      tips: [
        'Map과 Robot은 기본 표시됩니다.',
        '좌표 옆 SLAM 배지는 ROS publisher와 수신 데이터를 기준으로 Mapping·Localization의 2D/3D를 각각 표시합니다.',
        'Loop Closure의 노란 상태는 성공 로그 감지, 초록 상태는 Pose graph 보정 데이터까지 확인된 상태입니다.',
        '부분맵핑(Lifelong)은 직전 Mapping 경로와 Vertex/Graph를 이어서 사용합니다.',
        '저장하지 않은 Mapping을 종료하면 저장 여부를 한 번 더 확인합니다.',
        '검은 영역 또는 너무 가까운 위치를 목적지로 지정하면 주행을 시작하지 않습니다.',
        'Scan Fill은 그리기만, 그리기+지우기, 지우기만 중 적용 방식을 선택할 수 있습니다.',
        '맵 편집 전에는 반드시 백업을 남기세요.'
      ],
      shortcuts: [
        ['휠', '맵 확대/축소'],
        ['G', 'Navigation Goal 입력'],
        ['P', '초기 Pose 설정'],
        ['Ctrl+M', '맵 패널 접기/펼치기'],
        ['편집 1~5', '장애물/빈 공간/미확인/Scan Fill/이동 도구'],
        ['편집 Q · [ ]', '브러시 모양 · 크기 변경'],
        ['편집 Shift', '직선 입력'],
        ['편집 Space', '누르는 동안 Pan'],
        ['편집 Ctrl+Z', '마지막 편집 취소']
      ]
    },
    'tab-fleet-control': {
      title: '미니관제 사용 팁',
      intro: '연결된 로봇의 위치와 실행 Task를 한 맵에서 보고, 선택한 로봇에 Task를 전송합니다.',
      steps: [
        '활성 로봇을 바꾸면 해당 로봇의 맵이 미니관제 기준 맵으로 자동 동기화됩니다.',
        '맵의 로봇 아이콘이나 하단 로봇 칩을 눌러 대상 로봇을 선택하세요.',
        '오른쪽 저장 Task 목록에서 실행 내용을 먼저 확인하세요.',
        'Task 실행 버튼 또는 Ctrl+숫자로 미리보기 확인 후 전송하세요.'
      ],
      tips: [
        '맵이 오래됐거나 불일치하면 활성 로봇 맵 동기화 버튼으로 최신 맵을 다시 받으세요.',
        '파란 테두리가 현재 Task 대상입니다.',
        'Ctrl+번호는 저장 Task 이름 정렬 순서의 앞 9개입니다.'
      ],
      shortcuts: [
        ['Ctrl+1~9', '선택 로봇에 해당 번호 Task 미리보기'],
        ['Enter', '확인창의 Task 입력'],
        ['Esc', '확인창 취소']
      ]
    },
    'tab-dashboard': {
      title: 'Dashboard 사용 팁',
      intro: '활성 로봇의 작업 상태, 배터리, 위치와 주요 이벤트를 빠르게 확인합니다.',
      steps: [
        '상단 로봇 선택에서 데이터 수신 대상을 먼저 확인하세요.',
        'Work State와 BMS를 먼저 보고 이상이 있을 때 세부 정보로 들어가세요.',
        '필요한 카드만 Settings에서 표시해 화면을 단순하게 유지하세요.'
      ],
      tips: ['연결 상태가 대기라면 상단 연결 버튼에서 IP와 ROS 상태를 확인하세요.']
    },
    'tab-ros': {
      title: 'ROS Control 사용 팁',
      intro: '활성 로봇의 Topic, Node, Service, Action과 Parameter 상태를 조회합니다.',
      steps: [
        '대상 로봇이 맞는지 확인한 뒤 Refresh로 ROS 목록을 갱신하세요.',
        '검색창으로 이름을 좁힌 뒤 상세 타입과 연결 관계를 확인하세요.',
        '변경 명령은 현재 로봇과 값이 정확한지 재확인한 후 실행하세요.'
      ],
      tips: ['조회 결과가 없으면 ROS Bridge 연결과 RID namespace를 먼저 확인하세요.'],
      shortcuts: [['Ctrl+K', 'ROS Topic 검색창으로 이동']]
    },
    'tab-action': {
      title: 'Tasks 사용 팁',
      intro: 'Task를 빠르게 만들거나 상세 Action Queue를 편집하고 로봇에 전송합니다.',
      steps: [
        '화면 위쪽 최근 실행에서 직전에 보낸 Task 3개를 바로 다시 실행할 수 있습니다.',
        '기본 Task 토글에서 용도별 설정을 열어 Argument·Parameter·반복 횟수를 현장에 맞게 저장하세요.',
        'Quick Task에서 WayPoint·Trajectory는 주행 입력 완료를 누르세요. 곡선 경로는 그리기를 마치면 마지막 동작 선택창이 자동으로 열리며, 도킹·도킹아웃·스탠바이를 선택하거나 생략할 수 있습니다.',
        'Task Info로 Action과 파라미터를 검토하고 저장하세요.',
        '기존 Action의 수정 버튼을 누르면 변경된 Action만 저장하거나 같은 종류 중 선택한 Action에 파라미터를 적용할 수 있습니다.',
        '대상 로봇과 반복 횟수를 확인한 뒤 실행하세요.'
      ],
      tips: [
        '기본 Task 설정은 서버나 로봇 파일이 아니라 현재 PC의 EasyLoop 브라우저 저장소에 보관됩니다.',
        '기본 Task를 자유롭게 편집하려면 내 Task로 복사해 사용자 Task로 만드세요.',
        '최근 실행은 실행 당시 Action을 복제해 현재 브라우저 세션 동안만 보관합니다.',
        'Quick WayPoint 기본값은 전역 경로 + 장애물 회피입니다.',
        'Test Mode 주행은 SR-AMR-Base의 플래너별 가감속·도착 감속·방향 오차 계산을 경량 적용합니다.',
        'Test Mode 설정에서 DD를 선택하면 차동구동 회전 후 전진, QD를 선택하면 고정방향 주행으로 테스트합니다.',
        'straight_path를 켜면 직선을 우선하고, avoid_mode도 켜면 road_width 안에서 우회합니다.',
        'passing_flag는 다음 WayPoint/Trajectory로 속도를 유지해 넘기며 passing_dist가 클수록 더 일찍 전환됩니다.',
        'Trajectory의 lane_type·driving_type·lane_direction·collision_detect_range도 Test Mode 경로와 안전 정지에 반영됩니다.',
        'Test Mode가 실패하면 상단 TEST 메뉴에서 실패 원인·조치 방법·기술 정보를 확인하세요.',
        '파라미터 적용 대상 선택창은 action_type이 같은 Action만 표시하며 좌표·방향·이름은 유지합니다.',
        'avoid_mode를 끄면 rollout 회피가 꺼집니다. Test Mode는 충돌 직전에 안전 정지합니다.',
        '반복 0은 무한 반복이므로 현장 실행 전 주의하세요.'
      ],
      shortcuts: [
        ['W / T / G', 'Quick Task WayPoint / Trajectory / 곡선 경로'],
        ['D / O / S', 'Quick Task Docking / DockingOut / Standby'],
        ['F', 'Quick Task 주행 입력 완료'],
        ['D / O / S / N·0', '마지막 동작 선택 / 추가 없음'],
        ['I / E', 'Quick Task Info / 상세 편집'],
        ['Ctrl+S / Ctrl+Enter', 'Quick Task 저장 / 저장 후 실행'],
        ['Backspace / Esc', '마지막 항목 취소 / 입력 중지'],
        ['Ctrl+Z / Ctrl+Y', 'Action Queue Undo / Redo'],
        ['Enter', 'Tasks 탭의 Action 전송']
      ]
    },
    'tab-camera': {
      title: 'Camera 사용 팁',
      intro: '연결된 카메라 영상을 선택한 레이아웃으로 확인합니다.',
      steps: [
        'Depth와 Color 중 필요한 스트림만 선택하세요.',
        '화면 수에 맞는 레이아웃을 선택해 불필요한 디코딩 부하를 줄이세요.',
        '영상이 멈추면 Topic 이름과 수신 Hz를 확인하세요.'
      ],
      tips: ['저사양 PC에서는 한 번에 표시하는 카메라 수를 줄이세요.']
    },
    'tab-ssh': {
      title: 'Terminal 사용 팁',
      intro: '활성 로봇 SSH 세션에서 명령을 실행하고 출력 내용을 검색합니다.',
      steps: [
        '상단 활성 로봇과 SSH 연결 상태를 먼저 확인하세요.',
        '조회 명령부터 실행하고 변경 명령은 대상과 영향을 재확인하세요.',
        '검색 기능으로 긴 로그에서 필요한 문자열을 찾으세요.'
      ],
      tips: ['로봇 SSH에서는 명시적 지시 없이 설치·수정·삭제를 수행하지 마세요.'],
      shortcuts: [
        ['Ctrl+F', 'Terminal 검색 열기'],
        ['Enter', '검색 다음 결과'],
        ['Esc', 'Terminal 검색 닫기']
      ]
    },
    'tab-files': {
      title: 'Files 사용 팁',
      intro: '활성 로봇의 파일을 조회하고 업로드·다운로드합니다.',
      steps: [
        '현재 경로와 대상 로봇을 확인하세요.',
        '다운로드로 원본을 보관한 뒤 필요한 파일만 변경하세요.',
        '업로드 후 파일 크기와 수정 시간을 확인하세요.'
      ],
      tips: ['설정 파일을 덮어쓰기 전 백업을 권장합니다.']
    },
    'tab-batch': {
      title: 'Batch 사용 팁',
      intro: '여러 로봇에 동일한 조회 또는 작업을 순차적으로 수행합니다.',
      steps: [
        '대상 로봇 목록을 확인하고 소수 로봇으로 먼저 검증하세요.',
        '명령과 timeout을 확인한 뒤 실행하세요.',
        '성공·실패 결과를 로봇별로 확인하세요.'
      ],
      tips: ['변경 명령은 정상 기준 로봇에서 먼저 검증하세요.']
    },
    'tab-docking': {
      title: 'Docking 사용 팁',
      intro: '도킹·도킹 해제와 정밀 위치 보정 동작을 시험합니다.',
      steps: [
        '도킹 스테이션 주변이 안전한지 먼저 확인하세요.',
        '도킹 방향, 거리와 충전 요청 값을 확인하세요.',
        '실행 중 Pose와 결과 Topic을 함께 확인하세요.'
      ],
      tips: ['충전 접점이 연결된 상태에서는 강제 이동을 피하세요.']
    },
    'tab-monitoring': {
      title: 'Monitor 사용 팁',
      intro: 'CPU, 메모리, 디스크, 네트워크와 ROS 통신 상태를 관찰합니다.',
      steps: [
        '짧은 순간값보다 일정 시간의 추세를 확인하세요.',
        'CPU와 네트워크가 함께 상승하면 영상·LiDAR 표시 수를 줄여보세요.',
        '임계값 초과 항목은 Diagnostics와 로그에서 원인을 확인하세요.'
      ],
      tips: ['Mapping 중에는 CPU와 브라우저 렌더링 부하를 함께 확인하세요.']
    },
    'tab-scheduler': {
      title: 'Scheduler 사용 팁',
      intro: '정해진 시각 또는 조건에 실행할 작업을 구성합니다.',
      steps: [
        '실행 시간, 대상 로봇과 Task를 확인하세요.',
        '중복 일정과 무한 반복 Task 여부를 확인하세요.',
        '저장 후 활성화 상태와 다음 실행 시각을 확인하세요.'
      ],
      tips: ['현장 무인 실행 전 Test Mode 또는 감독 상태에서 먼저 검증하세요.']
    },
    'tab-diagnostics': {
      title: 'Diagnostics 사용 팁',
      intro: '증상 기반 점검, 상태 검사와 보고서 기능으로 문제 원인을 좁힙니다.',
      steps: [
        '현재 증상과 가장 가까운 진단 항목을 선택하세요.',
        '자동 조회 결과와 권장 확인 순서를 따라가세요.',
        '변경이 필요한 조치는 결과를 기록한 뒤 별도로 수행하세요.'
      ],
      tips: ['정상호기 비교 결과가 있으면 원인 판단이 더 정확해집니다.']
    },
    'tab-can-diag': {
      title: 'Motor Diag 사용 팁',
      intro: 'CANopen Node, SDO와 모터 상태를 엔지니어가 진단합니다.',
      steps: [
        'CAN interface와 대상 Node ID를 먼저 확인하세요.',
        'Read로 현재값을 확인한 뒤 필요한 경우에만 Write하세요.',
        '모터 구동 시험 전 바퀴가 뜬 상태와 비상정지 준비를 확인하세요.'
      ],
      tips: ['Node ID·Baudrate·STO 변경은 통신 두절이나 돌발 구동을 유발할 수 있습니다.']
    },
    'jog-panel': {
      title: 'Jog 사용 팁',
      intro: '활성 로봇을 수동 이동하고 리프트·차상·충전 기능을 제어합니다.',
      steps: [
        '차상 모델과 주행 타입이 실제 로봇과 맞는지 확인하세요.',
        '낮은 속도에서 이동 방향을 먼저 확인하세요.',
        '키를 놓으면 정지되는지 확인하고 비상 시 Space를 누르세요.'
      ],
      tips: ['충전 ON은 확인창 후 실행되며 OFF는 즉시 실행됩니다.'],
      shortcuts: [
        ['W / X / A / D', '전진 / 후진 / 좌 / 우'],
        ['Q / E', 'QD 회전'],
        ['S / Space', '즉시 정지'],
        ['Z / C', '리프트 상승 / 하강(누르는 동안)'],
        ['O / F', '충전 ON(확인) / OFF(즉시)'],
        ['+ / -', '선속도 조절'],
        ['Ctrl + / -', '각속도 조절']
      ]
    },
    'cmd-panel': {
      title: 'CMD 사용 팁',
      intro: '자주 쓰는 상태 조회와 명령 Snippet을 빠르게 실행합니다.',
      steps: [
        '대상 로봇을 확인하고 조회 명령부터 사용하세요.',
        '명령 설명과 영향을 확인한 뒤 실행하세요.',
        '반복 명령은 Snippet으로 저장하되 비밀번호는 저장하지 마세요.'
      ],
      tips: ['Restart·Reboot 명령은 로봇 운행이 멈춘 상태에서 실행하세요.']
    },
    'robot-manager-modal': {
      title: '로봇 관리 사용 팁',
      intro: '로봇을 검색·등록하고 연결 대상과 네트워크 정보를 관리합니다.',
      steps: ['대역을 확인하고 검색하세요.', 'RID가 확인된 로봇을 선택하세요.', '활성 로봇의 연결 상태를 확인하세요.'],
      tips: ['Test Mode 실행 중에는 검색 결과가 가상 Fleet를 교체하지 않습니다.']
    },
    'drive-simulation-modal': {
      title: '주행 A/B 시뮬레이션 사용 팁',
      intro: '현재 주행 설정과 개선 후보를 동일한 가상 경로에서 계산해 차이를 비교합니다.',
      steps: [
        '엔지니어로 로그인하고 Test Mode를 먼저 시작하세요.',
        '현재 설정을 읽은 뒤 시험 시나리오와 개선 후보 값을 확인하세요.',
        '동일 조건 비교 실행으로 궤적과 안전·추종·승차감 지표를 비교하세요.',
        '결과가 나아진 경우에만 개선 후보를 Test Mode에 임시 적용해 실제 Task로 재시험하세요.'
      ],
      tips: [
        'A/B 적용값은 Test Mode에만 사용되며 실제 로봇과 ROS Parameter를 변경하지 않습니다.',
        '현재 실행 Task 경로는 가상 Task가 실행 중일 때 선택할 수 있습니다.',
        '종합 점수만 보지 말고 충돌 여부, 최대 경로 이탈과 최소 장애물 여유를 함께 확인하세요.'
      ]
    },
    'init-setup-modal': {
      title: '초기 설정 사용 팁',
      intro: '네트워크, 환경 변수와 hosts를 초기 구성합니다.',
      steps: ['먼저 연결하고 Load Current를 실행하세요.', '현재값을 백업하세요.', '필요한 항목만 수정 후 적용하세요.'],
      tips: ['네트워크 설정 변경 시 SSH 연결이 끊길 수 있습니다.']
    }
  },

  globalShortcuts: [
    ['?', '전체 단축키 창 열기/닫기'],
    ['Esc', '열린 모달·메뉴·패널 닫기'],
    ['숫자 → Enter', '로봇 호기 번호 선택'],
    ['Backspace', '입력 중인 호기 번호 한 자리 삭제'],
    ['Ctrl+1~9', '일반 화면: 탭 전환 / 미니관제: 선택 로봇 Task'],
    ['Enter / Esc', '미니관제 Task 확인창 실행 / 취소'],
    ['J', 'Jog 패널 열기/닫기'],
    ['F', 'Jog 닫힘: 전체화면 / Jog 열림: 충전 OFF'],
    ['G / P', 'Navigation Goal / Pose 설정'],
    ['Ctrl+M', '맵 패널 접기/펼치기'],
    ['Ctrl+K', 'ROS 검색'],
    ['Ctrl+Z / Ctrl+Y', 'Undo / Redo'],
    ['Space', 'Jog 즉시 정지'],
    ['+ / -', 'Jog 선속도 증감'],
    ['Ctrl + / -', 'Jog 각속도 증감'],
    ['W/A/S/D/Q/E', 'Jog 이동·회전'],
    ['W/T/G/D/O/S/F', 'Quick Task 도구 (G: 곡선 경로)'],
    ['Ctrl+Enter', 'Quick Task 저장 후 실행'],
    ['Terminal Ctrl+F', 'Terminal 내용 검색'],
    ['맵 편집 1~5', '편집 도구 선택'],
    ['맵 편집 Q / [ ]', '브러시 모양 / 크기']
  ],

  init() {
    this._ensureModal();
    const targets = document.querySelectorAll(
      '.tab-content, #panel-map, #jog-panel, #cmd-panel, #event-log-panel, .modal'
    );
    targets.forEach(target => this._attach(target));
  },

  _attach(target) {
    if (!target?.id || target.id === 'usage-guide-modal'
        || target.id === 'fleet-shortcut-task-modal'
        || target.id === 'mapping-save-confirm-modal'
        || target.dataset.guideAttached === 'true') return;
    const host = target.classList.contains('modal')
      ? target.querySelector('.modal-content')
      : target;
    if (!host) return;
    target.dataset.guideAttached = 'true';
    const dock = document.createElement('div');
    dock.className = 'usage-guide-dock';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'usage-guide-trigger';
    button.innerHTML = '<span aria-hidden="true">📝</span><span>사용 팁</span>';
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      this.open(target.id);
    });
    dock.appendChild(button);
    host.insertBefore(dock, host.firstChild);
  },

  _fallbackGuide(id) {
    const target = document.getElementById(id);
    const heading = target?.querySelector('h2, h3, h4, .modal-header, .panel-title');
    const title = heading?.textContent?.trim() || '이 화면';
    return {
      title: `${title} 사용 팁`,
      intro: '현재 화면의 입력값과 대상 로봇을 확인한 뒤 기능을 실행하세요.',
      steps: [
        '상단 또는 선택 카드에서 대상 로봇을 확인하세요.',
        '현재값을 먼저 조회하고 필요한 항목만 변경하세요.',
        '실행 결과와 오류 메시지를 확인하세요.'
      ],
      tips: ['변경·삭제·재시작 기능은 영향을 확인한 뒤 실행하세요.']
    };
  },

  _ensureModal() {
    if (document.getElementById('usage-guide-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'usage-guide-modal';
    modal.className = 'modal usage-guide-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = `
      <div class="modal-content usage-guide-content">
        <div class="usage-guide-head">
          <div><span class="usage-guide-note-label">EASYLOOP NOTE</span><h3 id="usage-guide-title">사용 팁</h3></div>
          <button id="btn-usage-guide-close" class="modal-close" type="button" aria-label="닫기">&times;</button>
        </div>
        <p id="usage-guide-intro" class="usage-guide-intro"></p>
        <div class="usage-guide-sections">
          <section class="usage-guide-steps-section"><h4>빠른 사용 순서</h4><ol id="usage-guide-steps"></ol></section>
          <section id="usage-guide-tips-section"><h4>알아두기</h4><ul id="usage-guide-tips"></ul></section>
          <section id="usage-guide-shortcuts-section"><h4>이 화면 단축키</h4><div id="usage-guide-shortcuts" class="usage-guide-shortcuts"></div></section>
          <details class="usage-guide-all-shortcuts">
            <summary>전체 단축키 보기</summary>
            <div id="usage-guide-global-shortcuts" class="usage-guide-shortcuts"></div>
          </details>
        </div>
        <div class="modal-buttons"><button id="btn-usage-guide-ok" class="btn btn-primary" type="button">확인</button></div>
      </div>`;
    document.body.appendChild(modal);
    const close = () => modal.classList.remove('show');
    modal.addEventListener('click', event => {
      if (event.target === modal) close();
    });
    modal.querySelector('#btn-usage-guide-close')?.addEventListener('click', close);
    modal.querySelector('#btn-usage-guide-ok')?.addEventListener('click', close);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && modal.classList.contains('show')) close();
    });
    this._renderShortcutRows(
      modal.querySelector('#usage-guide-global-shortcuts'),
      this.globalShortcuts
    );
  },

  open(id) {
    const guide = this.guides[id] || this._fallbackGuide(id);
    const modal = document.getElementById('usage-guide-modal');
    if (!modal) return;
    modal.querySelector('#usage-guide-title').textContent = guide.title;
    modal.querySelector('#usage-guide-intro').textContent = guide.intro || '';
    this._renderList(modal.querySelector('#usage-guide-steps'), guide.steps || []);
    this._renderList(modal.querySelector('#usage-guide-tips'), guide.tips || []);
    modal.querySelector('#usage-guide-tips-section').hidden = !(guide.tips || []).length;
    this._renderShortcutRows(
      modal.querySelector('#usage-guide-shortcuts'),
      guide.shortcuts || []
    );
    const hasTips = Boolean((guide.tips || []).length);
    const hasShortcuts = Boolean((guide.shortcuts || []).length);
    modal.querySelector('#usage-guide-shortcuts-section').hidden = !hasShortcuts;
    modal.querySelector('.usage-guide-sections')?.classList.toggle(
      'single-secondary',
      hasTips !== hasShortcuts
    );
    const all = modal.querySelector('.usage-guide-all-shortcuts');
    if (all) all.open = false;
    modal.classList.add('show');
  },

  _renderList(container, items) {
    if (!container) return;
    container.innerHTML = '';
    items.forEach(text => {
      const item = document.createElement('li');
      item.textContent = text;
      container.appendChild(item);
    });
  },

  _renderShortcutRows(container, rows) {
    if (!container) return;
    container.innerHTML = '';
    rows.forEach(([keys, description]) => {
      const row = document.createElement('div');
      const key = document.createElement('kbd');
      const text = document.createElement('span');
      key.textContent = keys;
      text.textContent = description;
      row.appendChild(key);
      row.appendChild(text);
      container.appendChild(row);
    });
  }
};

document.addEventListener('DOMContentLoaded', () => UsageGuides.init());
