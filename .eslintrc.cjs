module.exports = {
  ignorePatterns: [
    'backup/**',
    'dist/**',
    'node_modules/**',
    'public/vendor/**'
  ],
  env: {
    browser: true,
    node: true,
    es2021: true
  },
  extends: [
    'eslint:recommended'
  ],
  parserOptions: {
    ecmaVersion: 2021
  },
  rules: {
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'no-empty': ['error', { allowEmptyCatch: true }],
    'no-constant-condition': ['error', { checkLoops: false }]
  },
  overrides: [
    {
      files: ['tests/**/*.js'],
      env: {
        jest: true,
        node: true
      }
    },
    {
      files: ['public/js/**/*.js'],
      globals: {
        ActionHistory: 'readonly',
        ActionSender: 'readonly',
        App: 'readonly',
        BMSTrend: 'readonly',
        CanDiag: 'readonly',
        CanRobotView: 'readonly',
        ConnTimeline: 'readonly',
        Dashboard: 'readonly',
        Diagnostics: 'readonly',
        DiagnosticTree: 'readonly',
        DockingTest: 'readonly',
        ErrorCodeDB: 'readonly',
        FileTransfer: 'readonly',
        FitAddon: 'readonly',
        FleetControl: 'readonly',
        I18n: 'readonly',
        IncidentReport: 'readonly',
        InitSetup: 'readonly',
        JogControl: 'readonly',
        MapContextMenu: 'readonly',
        ROSLIB: 'readonly',
        RosInfo: 'readonly',
        RosManager: 'readonly',
        RobotCompatibility: 'readonly',
        HealthCheck: 'readonly',
        SSHTerminal: 'readonly',
        SearchAddon: 'readonly',
        SysInfo: 'readonly',
        Terminal: 'readonly',
        TestMode: 'readonly',
        VelMonitor: 'readonly',
        fetchWithTimeout: 'readonly',
        _escapeHtml: 'readonly'
      }
    }
  ]
};
