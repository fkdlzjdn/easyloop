// No-Go Zone Editor - Draw and manage forbidden zones on map
const NoGoZoneEditor = {
  STORAGE_KEY: 'amrNoGoZones',
  _zones: [],           // [{id, points: [{x,y}...], closed: bool, color: string}]
  _editMode: false,
  _currentZone: null,   // Zone being drawn
  _selectedZone: null,  // Zone selected for editing
  _hoveredPoint: null,  // {zoneIdx, pointIdx}
  _draggingPoint: false,

  init() {
    this._zones = this.loadZones();
    this.setupUI();
    this.injectMapOverlay();
  },

  loadZones() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  },

  saveZones() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this._zones));
    } catch (e) {
      console.error('Failed to save no-go zones', e);
    }
  },

  setupUI() {
    const btn = document.getElementById('btn-nogo-edit');
    if (btn) {
      btn.addEventListener('click', () => this.toggleEditMode());
    }

    // Setup control panel handlers
    const panel = document.getElementById('nogo-panel');
    if (panel) {
      panel.querySelector('#btn-nogo-new')?.addEventListener('click', () => this.startNewZone());
      panel.querySelector('#btn-nogo-delete')?.addEventListener('click', () => this.deleteSelectedZone());
      panel.querySelector('#btn-nogo-clear')?.addEventListener('click', () => this.clearAllZones());
      panel.querySelector('#btn-nogo-export')?.addEventListener('click', () => this.exportZones());
      panel.querySelector('#btn-nogo-import')?.addEventListener('click', () => this.importZones());
      panel.querySelector('#btn-nogo-close')?.addEventListener('click', () => this.toggleEditMode());
    }
  },

  injectMapOverlay() {
    const canvas = document.getElementById('map-canvas');
    if (!canvas) return;

    // Use existing canvas, overlay drawing on top during renderMap
    // Hook into RosManager render cycle
    const originalDoRenderMap = RosManager._doRenderMap.bind(RosManager);
    RosManager._doRenderMap = (msg) => {
      originalDoRenderMap(msg);
      this.renderZonesOnMap();
    };

    // Mouse event handlers
    canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
    canvas.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    canvas.addEventListener('contextmenu', (e) => {
      if (this._editMode) {
        e.preventDefault();
        this.finishCurrentZone();
      }
    });
  },

  toggleEditMode() {
    this._editMode = !this._editMode;
    const panel = document.getElementById('nogo-panel');
    const btn = document.getElementById('btn-nogo-edit');

    if (this._editMode) {
      if (panel) panel.classList.remove('hidden');
      if (btn) btn.classList.add('active');
      this._currentZone = null;
      this._selectedZone = null;
      App.toast('No-Go Zone edit mode ON', 'info');
    } else {
      if (panel) panel.classList.add('hidden');
      if (btn) btn.classList.remove('active');
      this._currentZone = null;
      this._selectedZone = null;
      App.toast('No-Go Zone edit mode OFF', 'info');
    }

    this.updateZoneList();
    RosManager.requestRender();
  },

  startNewZone() {
    this._currentZone = {
      id: Date.now(),
      points: [],
      closed: false,
      color: '#ff4444'
    };
    this._selectedZone = null;
    App.toast('Click on map to add points, right-click or double-click to finish', 'info');
  },

  canvasToMapCoords(e) {
    const canvas = document.getElementById('map-canvas');
    if (!canvas || !RosManager.lastMapMsg) return null;

    const rect = canvas.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;

    const msg = RosManager.lastMapMsg;
    const width = msg.info.width;
    const height = msg.info.height;
    const resolution = msg.info.resolution;
    const origin = msg.info.origin;
    const rotation = RosManager.mapRotation;
    const zoom = RosManager.mapZoom;
    const panX = RosManager.mapPanX;
    const panY = RosManager.mapPanY;

    // Reverse the transforms: canvas -> map pixel -> world coords
    // Original: translate(w/2+panX, h/2+panY), scale(zoom), rotate(rot), draw at -width/2,-height/2
    const cx = canvas.width / 2 + panX;
    const cy = canvas.height / 2 + panY;

    // Undo translate
    let px = canvasX - cx;
    let py = canvasY - cy;

    // Undo zoom
    px /= zoom;
    py /= zoom;

    // Undo rotation
    const rotRad = -rotation * Math.PI / 180;
    const cosR = Math.cos(rotRad);
    const sinR = Math.sin(rotRad);
    const rx = cosR * px - sinR * py;
    const ry = sinR * px + cosR * py;

    // Map pixel coords (relative to image center)
    const mapPixelX = rx + width / 2;
    const mapPixelY = ry + height / 2;

    // Convert to world coords (Y is flipped in map)
    const worldX = origin.position.x + mapPixelX * resolution;
    const worldY = origin.position.y + (height - mapPixelY) * resolution;

    return { x: worldX, y: worldY, mapPixelX, mapPixelY };
  },

  worldToCanvasCoords(worldX, worldY) {
    const canvas = document.getElementById('map-canvas');
    if (!canvas || !RosManager.lastMapMsg) return null;

    const msg = RosManager.lastMapMsg;
    const width = msg.info.width;
    const height = msg.info.height;
    const resolution = msg.info.resolution;
    const origin = msg.info.origin;
    const rotation = RosManager.mapRotation;
    const zoom = RosManager.mapZoom;
    const panX = RosManager.mapPanX;
    const panY = RosManager.mapPanY;

    // World to map pixel
    const mapPixelX = (worldX - origin.position.x) / resolution;
    const mapPixelY = height - (worldY - origin.position.y) / resolution;

    // Relative to image center
    const rx = mapPixelX - width / 2;
    const ry = mapPixelY - height / 2;

    // Apply rotation
    const rotRad = rotation * Math.PI / 180;
    const cosR = Math.cos(rotRad);
    const sinR = Math.sin(rotRad);
    let px = cosR * rx - sinR * ry;
    let py = sinR * rx + cosR * ry;

    // Apply zoom
    px *= zoom;
    py *= zoom;

    // Apply translate
    const cx = canvas.width / 2 + panX;
    const cy = canvas.height / 2 + panY;

    return { x: cx + px, y: cy + py };
  },

  onMouseDown(e) {
    if (!this._editMode) return;
    if (e.button !== 0) return; // Left click only

    const coords = this.canvasToMapCoords(e);
    if (!coords) return;

    // Check if clicking on existing point to drag
    if (this._selectedZone !== null) {
      const zone = this._zones[this._selectedZone];
      if (zone) {
        for (let i = 0; i < zone.points.length; i++) {
          const pt = zone.points[i];
          const canvasPt = this.worldToCanvasCoords(pt.x, pt.y);
          if (canvasPt) {
            const dist = Math.sqrt(Math.pow(e.offsetX - canvasPt.x, 2) + Math.pow(e.offsetY - canvasPt.y, 2));
            if (dist < 10) {
              this._hoveredPoint = { zoneIdx: this._selectedZone, pointIdx: i };
              this._draggingPoint = true;
              return;
            }
          }
        }
      }
    }

    // If drawing new zone, add point
    if (this._currentZone) {
      this._currentZone.points.push({ x: coords.x, y: coords.y });
      RosManager.requestRender();
      return;
    }

    // Otherwise, try to select a zone
    this.selectZoneAt(coords.x, coords.y);
  },

  onMouseMove(e) {
    if (!this._editMode) return;

    if (this._draggingPoint && this._hoveredPoint) {
      const coords = this.canvasToMapCoords(e);
      if (!coords) return;

      const zone = this._zones[this._hoveredPoint.zoneIdx];
      if (zone) {
        zone.points[this._hoveredPoint.pointIdx] = { x: coords.x, y: coords.y };
        this.saveZones();
        RosManager.requestRender();
      }
    }
  },

  onMouseUp(e) {
    this._draggingPoint = false;
    this._hoveredPoint = null;
  },

  onDoubleClick(e) {
    if (!this._editMode) return;
    if (this._currentZone && this._currentZone.points.length >= 3) {
      this.finishCurrentZone();
    }
  },

  finishCurrentZone() {
    if (!this._currentZone) return;
    if (this._currentZone.points.length < 3) {
      App.toast('Zone needs at least 3 points', 'warning');
      this._currentZone = null;
      return;
    }

    this._currentZone.closed = true;
    this._zones.push(this._currentZone);
    this.saveZones();
    this.updateZoneList();
    App.toast('No-Go Zone created', 'success');
    this._currentZone = null;
    RosManager.requestRender();
  },

  selectZoneAt(worldX, worldY) {
    // Simple point-in-polygon check for selection
    for (let i = 0; i < this._zones.length; i++) {
      if (this.isPointInZone(worldX, worldY, this._zones[i])) {
        this._selectedZone = i;
        this.updateZoneList();
        RosManager.requestRender();
        return;
      }
    }
    this._selectedZone = null;
    this.updateZoneList();
    RosManager.requestRender();
  },

  isPointInZone(x, y, zone) {
    if (!zone.closed || zone.points.length < 3) return false;

    // Ray casting algorithm
    let inside = false;
    const pts = zone.points;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x, yi = pts[i].y;
      const xj = pts[j].x, yj = pts[j].y;

      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  },

  deleteSelectedZone() {
    if (this._selectedZone === null) {
      App.toast('No zone selected', 'warning');
      return;
    }

    this._zones.splice(this._selectedZone, 1);
    this._selectedZone = null;
    this.saveZones();
    this.updateZoneList();
    RosManager.requestRender();
    App.toast('Zone deleted', 'success');
  },

  clearAllZones() {
    if (!confirm('Clear all no-go zones?')) return;
    this._zones = [];
    this._selectedZone = null;
    this.saveZones();
    this.updateZoneList();
    RosManager.requestRender();
    App.toast('All zones cleared', 'success');
  },

  updateZoneList() {
    const listEl = document.getElementById('nogo-zone-list');
    if (!listEl) return;

    if (this._zones.length === 0) {
      listEl.innerHTML = '<div class="nogo-empty">No zones defined</div>';
      return;
    }

    listEl.innerHTML = this._zones.map((z, i) => `
      <div class="nogo-zone-item ${i === this._selectedZone ? 'selected' : ''}" data-idx="${i}">
        <span class="nogo-zone-color" style="background:${z.color}"></span>
        <span class="nogo-zone-name">Zone ${i + 1}</span>
        <span class="nogo-zone-pts">${z.points.length} pts</span>
      </div>
    `).join('');

    listEl.querySelectorAll('.nogo-zone-item').forEach(item => {
      item.addEventListener('click', () => {
        this._selectedZone = parseInt(item.dataset.idx);
        this.updateZoneList();
        RosManager.requestRender();
      });
    });
  },

  renderZonesOnMap() {
    const canvas = document.getElementById('map-canvas');
    if (!canvas || !RosManager.lastMapMsg) return;

    const ctx = canvas.getContext('2d');

    // Render all zones
    for (let i = 0; i < this._zones.length; i++) {
      const zone = this._zones[i];
      this.renderZone(ctx, zone, i === this._selectedZone);
    }

    // Render current zone being drawn
    if (this._currentZone && this._currentZone.points.length > 0) {
      this.renderZone(ctx, this._currentZone, true, true);
    }
  },

  renderZone(ctx, zone, isSelected, isDrawing = false) {
    if (zone.points.length < 1) return;

    const canvasPts = zone.points.map(pt => this.worldToCanvasCoords(pt.x, pt.y)).filter(p => p);
    if (canvasPts.length < 1) return;

    ctx.save();

    // Fill
    if (zone.closed || zone.points.length >= 3) {
      ctx.beginPath();
      ctx.moveTo(canvasPts[0].x, canvasPts[0].y);
      for (let i = 1; i < canvasPts.length; i++) {
        ctx.lineTo(canvasPts[i].x, canvasPts[i].y);
      }
      if (zone.closed) ctx.closePath();
      ctx.fillStyle = isDrawing ? 'rgba(255,100,100,0.3)' : 'rgba(255,68,68,0.4)';
      ctx.fill();
    }

    // Stroke
    ctx.beginPath();
    ctx.moveTo(canvasPts[0].x, canvasPts[0].y);
    for (let i = 1; i < canvasPts.length; i++) {
      ctx.lineTo(canvasPts[i].x, canvasPts[i].y);
    }
    if (zone.closed) ctx.closePath();
    ctx.strokeStyle = isSelected ? '#ffff00' : (zone.color || '#ff4444');
    ctx.lineWidth = isSelected ? 3 : 2;
    ctx.stroke();

    // Draw points in edit mode
    if (this._editMode && (isSelected || isDrawing)) {
      canvasPts.forEach((pt, i) => {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = zone.color || '#ff4444';
        ctx.lineWidth = 2;
        ctx.stroke();
      });
    }

    // Draw forbidden icon in center
    if (zone.closed && zone.points.length >= 3) {
      let cx = 0, cy = 0;
      canvasPts.forEach(pt => { cx += pt.x; cy += pt.y; });
      cx /= canvasPts.length;
      cy /= canvasPts.length;

      ctx.font = 'bold 16px sans-serif';
      ctx.fillStyle = '#ff4444';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⛔', cx, cy);
    }

    ctx.restore();
  },

  exportZones() {
    if (this._zones.length === 0) {
      App.toast('No zones to export', 'warning');
      return;
    }

    const data = {
      version: 1,
      zones: this._zones,
      exportedAt: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const link = document.createElement('a');
    link.download = `no-go-zones_${ts}.json`;
    link.href = URL.createObjectURL(blob);
    link.click();
    App.toast('Zones exported', 'success');
  },

  importZones() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          if (data.zones && Array.isArray(data.zones)) {
            const mergeChoice = confirm('Merge with existing zones? (Cancel to replace)');
            if (mergeChoice) {
              this._zones = [...this._zones, ...data.zones];
            } else {
              this._zones = data.zones;
            }
            this.saveZones();
            this.updateZoneList();
            RosManager.requestRender();
            App.toast(`Imported ${data.zones.length} zones`, 'success');
          } else {
            App.toast('Invalid zone file format', 'error');
          }
        } catch (err) {
          App.toast('Failed to parse zone file', 'error');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  NoGoZoneEditor.init();
});
