/* exported MapContextMenu */
/**
 * Map Context Menu Component
 * Provides right-click context menu for map interactions
 */

// eslint-disable-next-line no-unused-vars -- classic-script global consumed by ros-manager.js
const MapContextMenu = {
  menuElement: null,
  clickedCanvasX: 0,
  clickedCanvasY: 0,
  clickedWorldX: 0,
  clickedWorldY: 0,

  /**
   * Initialize the context menu
   */
  init() {
    // Create menu element if it doesn't exist
    if (!this.menuElement) {
      this._createMenuElement();
    }

    // Attach contextmenu listener to map canvas
    const mapCanvas = document.getElementById('map-canvas');
    if (mapCanvas) {
      mapCanvas.addEventListener('contextmenu', (e) => {
        this.show(e);
      });
    }

    // Close menu on click outside
    document.addEventListener('click', (e) => {
      if (this.menuElement && !this.menuElement.contains(e.target)) {
        this.hide();
      }
    });

    // Close menu on escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hide();
      }
    });
  },

  /**
   * Create the menu DOM element
   */
  _createMenuElement() {
    const menu = document.createElement('div');
    menu.className = 'map-context-menu';
    menu.style.cssText = `
      position: fixed;
      background: white;
      border: 1px solid #ccc;
      border-radius: 4px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      padding: 4px 0;
      z-index: 10000;
      display: none;
      min-width: 180px;
    `;

    menu.innerHTML = `
      <div class="menu-item" data-action="navigate" data-i18n="map.contextMenu.navigateHere" style="padding: 8px 16px; cursor: pointer; user-select: none;">Navigate Here</div>
      <div class="menu-item" data-action="setpose" data-i18n="map.contextMenu.setPoseHere" style="padding: 8px 16px; cursor: pointer; user-select: none;">Set Pose Here</div>
      <div class="menu-item" data-action="addpoi" data-i18n="map.contextMenu.addPoi" style="padding: 8px 16px; cursor: pointer; user-select: none;">Add POI</div>
      <div class="menu-item" data-action="copy" data-i18n="map.contextMenu.copyCoordinates" style="padding: 8px 16px; cursor: pointer; user-select: none;">Copy Coordinates</div>
    `;

    // Add hover styles
    const style = document.createElement('style');
    style.textContent = `
      .map-context-menu .menu-item:hover {
        background-color: #f0f0f0;
      }
    `;
    document.head.appendChild(style);

    // Attach click handlers
    const items = menu.querySelectorAll('.menu-item');
    items.forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = item.getAttribute('data-action');
        this._handleMenuAction(action);
        this.hide();
      });
    });

    document.body.appendChild(menu);
    this.menuElement = menu;
  },

  /**
   * Show the context menu at the click position
   */
  show(e) {
    e.preventDefault();

    // Check if RosManager and map data exist
    if (!window.RosManager || !window.RosManager.lastMapMsg) {
      console.warn('Map data not available');
      return;
    }

    const canvas = document.getElementById('map-canvas');
    if (!canvas) {
      return;
    }

    // Get canvas-relative coordinates
    const rect = canvas.getBoundingClientRect();
    this.clickedCanvasX = e.clientX - rect.left;
    this.clickedCanvasY = e.clientY - rect.top;

    // Convert to world coordinates
    const worldCoords = this._canvasToWorld(this.clickedCanvasX, this.clickedCanvasY);
    this.clickedWorldX = worldCoords.x;
    this.clickedWorldY = worldCoords.y;

    // Position menu near click
    const menuWidth = 180;
    const menuHeight = 140; // Approximate height
    let menuX = e.clientX;
    let menuY = e.clientY;

    // Keep menu within viewport
    if (menuX + menuWidth > window.innerWidth) {
      menuX = window.innerWidth - menuWidth - 10;
    }
    if (menuY + menuHeight > window.innerHeight) {
      menuY = window.innerHeight - menuHeight - 10;
    }

    this.menuElement.style.left = menuX + 'px';
    this.menuElement.style.top = menuY + 'px';
    this.menuElement.style.display = 'block';
  },

  /**
   * Hide the context menu
   */
  hide() {
    if (this.menuElement) {
      this.menuElement.style.display = 'none';
    }
  },

  /**
   * Handle menu item action
   */
  _handleMenuAction(action) {
    switch (action) {
      case 'navigate':
        this._navigateHere(this.clickedWorldX, this.clickedWorldY);
        break;
      case 'setpose':
        this._setPoseHere(this.clickedWorldX, this.clickedWorldY);
        break;
      case 'addpoi':
        this._addPoiHere(this.clickedWorldX, this.clickedWorldY);
        break;
      case 'copy':
        this._copyCoords(this.clickedWorldX, this.clickedWorldY);
        break;
    }
  },

  /**
   * Convert canvas pixel coordinates to map world coordinates
   */
  _canvasToWorld(canvasX, canvasY) {
    const canvas = document.getElementById('map-canvas');
    if (!canvas) {
      return { x: 0, y: 0 };
    }

    const msg = window.RosManager.lastMapMsg;
    const mapZoom = window.RosManager.mapZoom || 1.0;
    const mapPanX = window.RosManager.mapPanX || 0;
    const mapPanY = window.RosManager.mapPanY || 0;
    const mapRotation = window.RosManager.mapRotation || 0;

    const resolution = msg.info.resolution;
    const originX = msg.info.origin.position.x;
    const originY = msg.info.origin.position.y;

    // Canvas center
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    // Reverse the rendering transform
    // 1. Subtract pan to get pre-pan coordinates
    let x = canvasX - mapPanX;
    let y = canvasY - mapPanY;

    // 2. Translate to origin (center of canvas)
    x -= centerX;
    y -= centerY;

    // 3. Reverse zoom
    x /= mapZoom;
    y /= mapZoom;

    // 4. Reverse rotation (rotate by -mapRotation)
    if (mapRotation !== 0) {
      const cosR = Math.cos(-mapRotation);
      const sinR = Math.sin(-mapRotation);
      const rotatedX = x * cosR - y * sinR;
      const rotatedY = x * sinR + y * cosR;
      x = rotatedX;
      y = rotatedY;
    }

    // 5. Convert from canvas coordinates to world coordinates
    // Canvas Y is flipped (down is positive), world Y is up is positive
    const worldX = originX + (x * resolution);
    const worldY = originY + (msg.info.height * resolution) - (y * resolution);

    return { x: worldX, y: worldY };
  },

  /**
   * Set navigation goal at the clicked position
   */
  _navigateHere(x, y) {
    if (!window.RosManager) {
      console.error('RosManager not available');
      return;
    }

    if (window.RosManager._publishNavGoal) {
      window.RosManager._publishNavGoal(x, y, 0);
      console.log(`Navigation goal set to: (${x.toFixed(2)}, ${y.toFixed(2)})`);
      App.toast('Navigation goal set', 'success');
    } else {
      App.toast('Navigation not available', 'error');
    }
  },

  /**
   * Set initial pose at the clicked position
   */
  _setPoseHere(x, y) {
    if (!window.RosManager) {
      console.error('RosManager not available');
      return;
    }

    if (window.RosManager._publishInitialPoseValues) {
      window.RosManager._publishInitialPoseValues(x, y, 0);
      console.log(`Initial pose set to: (${x.toFixed(2)}, ${y.toFixed(2)})`);
      App.toast('Initial pose set', 'success');
    } else {
      App.toast('Pose setting not available', 'error');
    }
  },

  /**
   * Add POI at the clicked position
   */
  _addPoiHere(x, y) {
    if (!window.RosManager) {
      console.error('RosManager not available');
      return;
    }

    // Add POI
    if (window.RosManager.addPOI) {
      const poiName = prompt('Enter POI name:');
      if (poiName && poiName.trim()) {
        window.RosManager.addPOI(poiName.trim(), x, y);
        console.log(`POI added: ${poiName} at (${x.toFixed(2)}, ${y.toFixed(2)})`);

        App.toast('POI added', 'success');
      }
    }
  },

  /**
   * Copy coordinates to clipboard
   */
  _copyCoords(x, y) {
    const coordText = `X: ${x.toFixed(3)}, Y: ${y.toFixed(3)}`;

    // Copy to clipboard
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(coordText)
        .then(() => {
          App.toast('Coordinates copied', 'success');
        })
        .catch(() => {
          App.toast(coordText, 'info');
        });
    } else {
      const textArea = document.createElement('textarea');
      textArea.value = coordText;
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        App.toast('Coordinates copied', 'success');
      } catch (err) {
        App.toast(coordText, 'info');
      }
      document.body.removeChild(textArea);
    }
  }
};
