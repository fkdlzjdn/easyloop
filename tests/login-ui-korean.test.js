const fs = require('fs');
const path = require('path');

describe('Korean-first login UI', () => {
  const indexHtml = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'index.html'),
    'utf8'
  );
  const appSource = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'app.js'),
    'utf8'
  );

  test('renders useful Korean login text before translations load', () => {
    expect(indexHtml).toContain('<html lang="ko">');
    expect(indexHtml).toContain('<span class="role-label">일반 사용자</span>');
    expect(indexHtml).toContain('<span class="role-label">엔지니어</span>');
    expect(indexHtml).toContain('placeholder="비밀번호"');
    expect(indexHtml).toContain('>로그인</button>');
  });

  test('does not truncate normal shared passwords to ten characters', () => {
    expect(indexHtml).toContain('id="password-input"');
    expect(indexHtml).toContain('maxlength="128"');
    expect(indexHtml).not.toContain('id="password-input" data-i18n-placeholder="login.placeholder" placeholder="Password" maxlength="10"');
  });

  test('initializes authentication and core UI without waiting for translations', () => {
    const authPosition = appSource.indexOf('App.setupPasswordAuth();');
    const appPosition = appSource.indexOf('App.init();', authPosition);
    const i18nPosition = appSource.indexOf('I18n.init().catch', appPosition);

    expect(authPosition).toBeGreaterThan(-1);
    expect(appPosition).toBeGreaterThan(authPosition);
    expect(i18nPosition).toBeGreaterThan(appPosition);
    expect(i18nPosition).toBeGreaterThan(-1);
    expect(appSource).not.toContain('await I18n.init()');
  });
});
