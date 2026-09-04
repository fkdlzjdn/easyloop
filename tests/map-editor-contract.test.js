const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'public', 'js', 'ros-manager.js'), 'utf8');

describe('Map editor UI/source contract', () => {
  test('every map editor action control exists', () => {
    [
      'btn-map-edit-toggle',
      'btn-brush-shape',
      'map-edit-brush-size',
      'btn-map-edit-raycast',
      'raycast-mode',
      'raycast-max-range',
      'btn-map-edit-undo',
      'btn-map-edit-reset',
      'btn-map-edit-save',
      'btn-map-edit-cancel',
      'btn-map-backup',
      'map-edit-apply-after-save',
      'scan-fill-mode',
      'btn-map-backup-close',
      'btn-map-backup-close2',
      'btn-map-backup-restore',
      'btn-map-backup-rename',
      'btn-map-backup-delete'
    ].forEach(id => expect(html).toContain(`id="${id}"`));
    ['obstacle', 'free', 'unknown', 'scan-fill', 'move'].forEach(tool => {
      expect(html).toContain(`data-tool="${tool}"`);
    });
  });

  test('every action control is connected to its implementation', () => {
    [
      "editBtn.addEventListener('click'",
      "shapeBtn.addEventListener('click'",
      "brushSlider.addEventListener('input'",
      "raycastBtn.addEventListener('click', () => this.applyLidarRaycast())",
      "undoBtn.addEventListener('click', () => this._undoEdit())",
      "resetBtn.addEventListener('click', () => this._resetEdit())",
      "saveBtn.addEventListener('click'",
      "cancelBtn.addEventListener('click'",
      "backupBtn.addEventListener('click', () => this._showMapBackups())",
      'this._restoreMapBackup(this._selectedBackup)',
      'this._deleteMapBackup(this._selectedBackup)',
      'this._renameMapBackup(this._selectedBackup)',
      "document.getElementById('map-edit-apply-after-save')",
      "document.getElementById('scan-fill-mode')",
      "document.getElementById('raycast-mode')",
      "document.getElementById('raycast-max-range')"
    ].forEach(contract => expect(source).toContain(contract));
  });

  test('tool values map to OccupancyGrid obstacle/free/unknown values', () => {
    expect(source).toContain("case 'obstacle': value = 100");
    expect(source).toContain("case 'free': value = 0");
    expect(source).toContain("case 'unknown': value = -1");
    expect(source).toContain("return ['draw', 'both', 'clear'].includes(value)");
    expect(source).toContain("const doDraw = mode === 'draw' || mode === 'both'");
    expect(source).toContain("const doClear = mode === 'clear' || mode === 'both'");
  });

  test('save path creates a backup before uploading canonical PGM and YAML', () => {
    const backupAt = source.indexOf('await this._backupCanonicalMap(profile, { trackSave: false })');
    const pgmAt = source.indexOf("pgmFormData.append('file'");
    const yamlAt = source.indexOf("yamlFormData.append('file'");
    expect(backupAt).toBeGreaterThan(0);
    expect(pgmAt).toBeGreaterThan(backupAt);
    expect(yamlAt).toBeGreaterThan(pgmAt);
    expect(source).toContain("const mapName = 'map'");
    expect(source).toContain("const remotePath = `/home/syscon/ROS_DB/map`");
  });
});
