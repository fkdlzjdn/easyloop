// Smart Alarm Rules - Complex conditional alarms
const SmartAlarm = {
  _rules: [],
  _checkInterval: null,
  _lastValues: {},

  init() {
    this.loadRules();
    this.bindEvents();
    this.renderRules();
    this.startChecking();
  },

  bindEvents() {
    const addBtn = document.getElementById('btn-add-smart-alarm');
    if (addBtn) {
      addBtn.addEventListener('click', () => this.addRule());
    }

    // Save rules when alarm settings save
    const saveBtn = document.getElementById('btn-alarm-save');
    if (saveBtn) {
      const origClick = saveBtn.onclick;
      saveBtn.addEventListener('click', () => {
        this.saveRules();
      });
    }
  },

  loadRules() {
    try {
      const saved = localStorage.getItem('amrSmartAlarmRules');
      this._rules = saved ? JSON.parse(saved) : [];
    } catch (e) {
      this._rules = [];
    }
  },

  saveRules() {
    // Collect rules from DOM
    const rules = [];
    document.querySelectorAll('.smart-alarm-rule').forEach(el => {
      const rule = {
        id: el.dataset.ruleId || this.genId(),
        enabled: el.querySelector('.sar-enabled').checked,
        name: el.querySelector('.sar-name').value || 'Unnamed Rule',
        metric: el.querySelector('.sar-metric').value,
        op: el.querySelector('.sar-op').value,
        value: parseFloat(el.querySelector('.sar-value').value) || 0,
        actToast: el.querySelector('.sar-act-toast').checked,
        actSound: el.querySelector('.sar-act-sound').checked,
        actLog: el.querySelector('.sar-act-log').checked,
        triggered: false
      };
      rules.push(rule);
    });
    this._rules = rules;
    try { localStorage.setItem('amrSmartAlarmRules', JSON.stringify(rules)); }
    catch (e) { console.warn('Failed to save alarm rules:', e.message); }
  },

  renderRules() {
    const list = document.getElementById('smart-alarm-list');
    const tpl = document.getElementById('smart-alarm-rule-tpl');
    if (!list || !tpl) return;

    list.innerHTML = '';
    this._rules.forEach(rule => {
      const clone = tpl.content.cloneNode(true);
      const el = clone.querySelector('.smart-alarm-rule');
      el.dataset.ruleId = rule.id;
      el.querySelector('.sar-enabled').checked = rule.enabled;
      el.querySelector('.sar-name').value = rule.name;
      el.querySelector('.sar-metric').value = rule.metric;
      el.querySelector('.sar-op').value = rule.op;
      el.querySelector('.sar-value').value = rule.value;
      el.querySelector('.sar-act-toast').checked = rule.actToast;
      el.querySelector('.sar-act-sound').checked = rule.actSound;
      el.querySelector('.sar-act-log').checked = rule.actLog;

      // Delete handler
      el.querySelector('.sar-delete').addEventListener('click', () => {
        el.remove();
        this.saveRules();
      });

      list.appendChild(clone);
    });
  },

  addRule() {
    const newRule = {
      id: this.genId(),
      enabled: true,
      name: 'New Rule',
      metric: 'cpu',
      op: 'gt',
      value: 80,
      actToast: true,
      actSound: false,
      actLog: true,
      triggered: false
    };
    this._rules.push(newRule);
    this.renderRules();
  },

  genId() {
    return 'sar_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
  },

  startChecking() {
    this._checkInterval = setInterval(() => this.checkRules(), 5000);
  },

  stopChecking() {
    if (this._checkInterval) {
      clearInterval(this._checkInterval);
      this._checkInterval = null;
    }
  },

  // Get current metric values from various sources
  getCurrentValues() {
    const values = {};

    // CPU/Memory/Disk/Temp from SysInfo
    const cpuEl = document.getElementById('sysinfo-cpu');
    const memEl = document.getElementById('sysinfo-mem');
    const diskEl = document.getElementById('sysinfo-disk');
    const tempEl = document.getElementById('sysinfo-temp');

    if (cpuEl) values.cpu = parseFloat(cpuEl.textContent) || 0;
    if (memEl) values.mem = parseFloat(memEl.textContent) || 0;
    if (diskEl) values.disk = parseFloat(diskEl.textContent) || 0;
    if (tempEl) values.temp = parseFloat(tempEl.textContent) || 0;

    // BMS from gauge
    const bmsEl = document.getElementById('bms-gauge-text');
    if (bmsEl) values.bms = parseFloat(bmsEl.textContent) || 0;

    // Work state
    const wsEl = document.getElementById('header-ws-text');
    if (wsEl) values.workstate = parseInt(wsEl.textContent) || 0;

    return values;
  },

  checkRules() {
    if (!this._rules.length) return;

    const values = this.getCurrentValues();

    this._rules.forEach(rule => {
      if (!rule.enabled) return;

      const current = values[rule.metric];
      if (current === undefined) return;

      const condition = this.evaluateCondition(current, rule.op, rule.value);

      if (condition && !rule.triggered) {
        // Trigger alarm
        rule.triggered = true;
        this.triggerAlarm(rule, current);
      } else if (!condition && rule.triggered) {
        // Reset trigger
        rule.triggered = false;
      }
    });
  },

  evaluateCondition(current, op, threshold) {
    switch (op) {
      case 'gt': return current > threshold;
      case 'gte': return current >= threshold;
      case 'lt': return current < threshold;
      case 'lte': return current <= threshold;
      case 'eq': return current === threshold;
      case 'ne': return current !== threshold;
      default: return false;
    }
  },

  triggerAlarm(rule, currentValue) {
    const msg = `${rule.name}: ${rule.metric} is ${currentValue} (threshold: ${rule.op} ${rule.value})`;

    if (rule.actToast && typeof App !== 'undefined') {
      App.toast(msg, 'warning');
    }

    if (rule.actSound) {
      this.playAlarmSound();
    }

    if (rule.actLog && typeof App !== 'undefined') {
      App.logEvent({
        type: 'notification',
        level: 'warning',
        title: `Smart Alarm: ${rule.name}`,
        detail: msg
      });
    }
  },

  playAlarmSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.value = 0.3;
      osc.start();
      setTimeout(() => {
        osc.stop();
        ctx.close();
      }, 200);
    } catch (e) {
      console.warn('Could not play alarm sound:', e);
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  SmartAlarm.init();
});
