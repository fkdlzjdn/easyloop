/**
 * LS/DM Series Servo Driver Error Code Database
 * Based on: LS及DM系列低压伺服驱动器手册 p.99~101
 */

const LS_ERROR_CODES = {
  0x0000: { code: 0, name: '정상', level: 'OK', action: '' },
  0x04B0: { code: 1200, name: '방전저항 이상', level: 'FAULT', action: 'Fn16B 값 변경 (20으로)' },
  0x0515: { code: 1301, name: '통신 타임아웃', level: 'WARN', action: '상위 장치 통신 간격 재설정' },
  0x0528: { code: 1320, name: '오프라인 정지', level: 'WARN', action: '통신 간격 재설정 또는 오프라인 감지 해제(Fn1CD=0)' },
  0x0532: { code: 1330, name: '자체 활성 정지', level: 'WARN', action: '자체 활성 정지 비활성화(Fn1BF=0)' },
  0x0579: { code: 1401, name: '드라이버 무응답', level: 'WARN', action: '모터 케이블/설치 확인, 토크 제한 확인' },
  0x05DC: { code: 1500, name: '엔코더 AB 알람', level: 'WARN', action: '엔코더 배선 확인' },
  0x05E6: { code: 1510, name: '엔코더 UVW 알람', level: 'WARN', action: '엔코더 배선 확인, Dn04 값 변화 확인' },
  0x05E7: { code: 1511, name: '엔코더 UVW 알람', level: 'WARN', action: '엔코더 배선 확인' },
  0x0640: { code: 1600, name: 'FRAM 읽기/쓰기 이상', level: 'FAULT', action: '제조사 수리' },
  0x06A4: { code: 1700, name: '전자기어 이상', level: 'WARN', action: 'Fn050~Fn054 확인' },
  0x076C: { code: 1900, name: '미등재 에러', level: 'FAULT', action: '드라이버 교체 필요' },
  0x0898: { code: 2200, name: '저전압', level: 'WARN', action: '전원 전압 확인, Fn0D1 역치 확인' },
  0x09C4: { code: 2500, name: '과전류', level: 'WARN', action: 'U/V/W 배선 확인, 게인 조정' },
  0x09C5: { code: 2501, name: '과전류', level: 'WARN', action: 'U/V/W 배선 확인' },
  0x09C6: { code: 2502, name: '과전류', level: 'WARN', action: 'U/V/W 배선 확인' },
  0x09CE: { code: 2510, name: '과부하', level: 'FAULT', action: '부하 감소, 엔코더 확인, 가감속 시간 증가' },
  0x09D8: { code: 2520, name: '과속', level: 'WARN', action: '속도 명령 확인, 엔코더 확인' },
  0x09E2: { code: 2530, name: '전원 과전압', level: 'FAULT', action: '전원 전압 확인, 방전저항 확인' },
  0x09EC: { code: 2540, name: '위상전압 이상', level: 'FAULT', action: '제조사 수리, Fn0FD=21930 설정' },
  0x0A28: { code: 2600, name: '파라미터 설정 이상', level: 'FAULT', action: '공장 초기화 후 재설정' },
  0x0A2D: { code: 2605, name: '영점 타임아웃', level: 'WARN', action: 'Fn1AD 값 증가' },
  0x0A32: { code: 2610, name: '위치편차 오버플로', level: 'WARN', action: '펄스 주파수/게인 조정, 부하 확인' },
  0x0A46: { code: 2630, name: '과열', level: 'WARN', action: 'Fn0E7 역치 확인, Dn25 온도 확인' },
  0x0A55: { code: 2645, name: '오버트래블', level: 'WARN', action: 'Fn0DA 설정 확인, 엔코더 확인' },
  0x0A64: { code: 2660, name: '1상 알람', level: 'FAULT', action: '제조사 수리' },
  0x0A65: { code: 2661, name: '2상 알람', level: 'FAULT', action: '제조사 수리' },
  0x0B54: { code: 2900, name: '로터 잠김/스톨', level: 'WARN', action: '엔코더/모터 확인, 가감속 시간 증가' },
  0x0B72: { code: 2930, name: 'STO 경고', level: 'FAULT', action: 'STO 하드웨어 핀 확인 또는 Fn035=0x55AA(STO OFF)' },
  0x0B73: { code: 2931, name: 'STO 경고', level: 'FAULT', action: 'STO 하드웨어 핀 확인' },
  0x0C26: { code: 3110, name: '드라이버-모터 불일치', level: 'FAULT', action: 'Fn006 모터 코드 재설정' },
  0x0E10: { code: 3600, name: '엔코더 Z상 소실', level: 'WARN', action: '엔코더 배선 확인' },
  0x0E11: { code: 3601, name: '엔코더 Z상 과다', level: 'WARN', action: '엔코더 배선 확인, Fn135 증가' },
};

/**
 * Look up an error code.
 * @param {number} errorCode - 16-bit error code from SDO read
 * @returns {{ code: number, name: string, level: string, action: string }}
 */
function lookupError(errorCode) {
  return LS_ERROR_CODES[errorCode] || {
    code: errorCode,
    name: `미등록 에러 (0x${errorCode.toString(16).toUpperCase().padStart(4, '0')})`,
    level: 'UNKNOWN',
    action: '매뉴얼 참조'
  };
}

module.exports = { LS_ERROR_CODES, lookupError };
