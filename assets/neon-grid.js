/**
 * Neon Grid Background - Interactive Effects
 * Creates an interactive grid background with neon effects
 */

class NeonGridBackground {
  constructor() {
    this.gridContainer = null;
    this.gridCells = [];
    this.mouse = { x: -999, y: -999 };
    this.isEnabled = true;
    this.cellSize = 60;
    this._rafId = null;
    this._dirty = false;

    // Save bound references for addEventListener / removeEventListener
    this._onMouseMove = (e) => this.handleMouseMove(e);
    this._onTouchMove = (e) => {
      if (e.touches[0]) {
        this.handleMouseMove({
          clientX: e.touches[0].clientX,
          clientY: e.touches[0].clientY
        });
      }
    };
    this._onResize = () => this.handleResize();

    // Determine cell size BEFORE creating cells
    this._updateCellSize();

    // Initialize
    this.init();
    this.addEventListeners();
  }

  _updateCellSize() {
    if (window.innerWidth <= 480) {
      this.cellSize = 30;
    } else if (window.innerWidth <= 768) {
      this.cellSize = 40;
    } else {
      this.cellSize = 60;
    }
  }

  init() {
    // Create main grid background
    const gridBg = document.createElement('div');
    gridBg.className = 'neon-grid-bg interactive';
    document.body.insertBefore(gridBg, document.body.firstChild);
    this.gridContainer = gridBg;

    // Create grid cells for interactive hover effects
    this.createGridCells();

    // Add neon mode to body
    document.body.classList.add('neon-mode');
  }

  createGridCells() {
    const cols = Math.ceil(window.innerWidth / this.cellSize) + 2;
    const rows = Math.ceil(window.innerHeight / this.cellSize) + 2;
    const halfCell = this.cellSize / 2;

    // Use DocumentFragment to batch DOM insertions
    const frag = document.createDocumentFragment();

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const cell = document.createElement('div');
        cell.className = 'grid-cell-interactive';
        const left = col * this.cellSize;
        const top = row * this.cellSize;
        cell.style.left = left + 'px';
        cell.style.top = top + 'px';
        // Cache center coordinates to avoid getBoundingClientRect on every mousemove
        cell._cx = left + halfCell;
        cell._cy = top + halfCell;
        frag.appendChild(cell);
        this.gridCells.push(cell);
      }
    }

    document.body.appendChild(frag);
  }

  addEventListeners() {
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('touchmove', this._onTouchMove, { passive: true });
    window.addEventListener('resize', this._onResize);
    document.addEventListener('themeChanged', () => this.updateTheme());
  }

  handleMouseMove(e) {
    if (!this.isEnabled) return;

    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;

    // Batch updates via rAF to avoid layout thrashing
    if (!this._dirty) {
      this._dirty = true;
      this._rafId = requestAnimationFrame(() => {
        this.updateCellsNearMouse();
        this._dirty = false;
      });
    }
  }

  updateCellsNearMouse() {
    const activationRadius = 150;
    const mx = this.mouse.x;
    const my = this.mouse.y;

    // Use cached cell center positions instead of getBoundingClientRect
    // This is a massive performance improvement (avoids forced reflow per cell)
    this.gridCells.forEach(cell => {
      const dx = mx - cell._cx;
      const dy = my - cell._cy;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < activationRadius) {
        cell.classList.add('active');
        cell.style.opacity = String(1 - (distance / activationRadius));
      } else if (cell.classList.contains('active')) {
        cell.classList.remove('active');
        cell.style.opacity = '0';
      }
    });
  }

  handleResize() {
    // Clear old cells
    this.gridCells.forEach(cell => cell.remove());
    this.gridCells = [];

    // Update cell size based on screen size
    this._updateCellSize();

    // Recreate cells
    this.createGridCells();
  }

  updateTheme() {
    // Grid background updates automatically via CSS variables
  }

  toggleGrid(enabled) {
    this.isEnabled = enabled;
    if (enabled) {
      this.gridContainer.classList.add('interactive');
    } else {
      this.gridContainer.classList.remove('interactive');
      this.gridCells.forEach(cell => cell.classList.remove('active'));
    }
  }

  destroy() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('touchmove', this._onTouchMove);
    window.removeEventListener('resize', this._onResize);
    this.gridCells.forEach(cell => cell.remove());
    if (this.gridContainer) {
      this.gridContainer.remove();
    }
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.neonGrid = new NeonGridBackground();
  });
} else {
  window.neonGrid = new NeonGridBackground();
}

// Expose toggle function for external control
window.toggleNeonGrid = function(enabled) {
  if (window.neonGrid) {
    window.neonGrid.toggleGrid(enabled);
  }
};
