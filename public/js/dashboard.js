// Dashboard - data exports
const Dashboard = {
  init() {
    this.bindEvents();
  },

  bindEvents() {
    const exportCsvBtn = document.getElementById('btn-export-logs-csv');
    if (exportCsvBtn) {
      exportCsvBtn.addEventListener('click', () => this.exportToCSV());
    }

    const exportBmsBtn = document.getElementById('btn-export-bms-csv');
    if (exportBmsBtn) {
      exportBmsBtn.addEventListener('click', () => this.exportBMSTrendToCSV());
    }
  },

  // App event logging calls this hook. Dashboard history cards were removed.
  render() {},

  // Export event logs to CSV
  exportToCSV() {
    const logs = App.getEventLog();
    if (!logs.length) {
      App.toast('No data to export', 'info');
      return;
    }

    const headers = ['Timestamp', 'Type', 'Level', 'Title', 'Detail'];
    const rows = logs.map(log => [
      new Date(log.at).toISOString(),
      log.type || '',
      log.level || '',
      (log.title || '').replace(/"/g, '""'),
      (log.detail || '').replace(/"/g, '""')
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(r => r.map(c => `"${c}"`).join(','))
    ].join('\n');

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const link = document.createElement('a');
    link.download = `amr-logs_${ts}.csv`;
    link.href = URL.createObjectURL(blob);
    link.click();

    App.toast('Logs exported to CSV', 'success');
  },

  // Export BMS trend data to CSV
  exportBMSTrendToCSV() {
    if (typeof BMSTrend === 'undefined' || !BMSTrend._history || !BMSTrend._history.length) {
      App.toast('No BMS data to export', 'info');
      return;
    }

    const headers = ['Timestamp', 'SOC (%)', 'Voltage (V)', 'Current (A)'];
    const rows = BMSTrend._history.map(h => [
      new Date(h.time).toISOString(),
      h.soc !== undefined ? h.soc : '',
      h.voltage !== undefined ? h.voltage : '',
      h.current !== undefined ? h.current : ''
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(r => r.join(','))
    ].join('\n');

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const link = document.createElement('a');
    link.download = `amr-bms-trend_${ts}.csv`;
    link.href = URL.createObjectURL(blob);
    link.click();

    App.toast('BMS trend exported to CSV', 'success');
  }
};

document.addEventListener('DOMContentLoaded', () => {
  if (typeof App !== 'undefined') {
    Dashboard.init();
  }
});
