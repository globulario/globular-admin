/**
 * A container Web Component that creates a resizable split view.
 * It automatically inserts splitter sliders between child <globular-split-pane> elements.
 *
 * @element globular-split-view
 * @slot The <globular-split-pane> elements to be split.
 */
export class SplitView extends HTMLElement {
    // Private fields for encapsulation.
    #splitters = [];
    #isVertical = false;
    #slotObserver = null;

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });

        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: flex;
                    width: 100%;
                    height: 100%;
                    min-width: 0;
                    min-height: 0;
                }
                .splitter {
                    display: flex;
                    flex: 1 1 auto;
                    width: 100%;
                    height: 100%; /* Ensure it takes up full height */
                }
                /* Slot styles are fine, but could be moved to host if desired */
                ::slotted(globular-split-pane) {
                    flex: 1 1 0;
                    min-width: 0;
                    min-height: 0;
                    display: flex;
                    overflow: auto;
                }
                ::-webkit-scrollbar {
                    width: 10px;
                }
                ::-webkit-scrollbar-track {
                    background: var(--scroll-track, var(--surface-color));
                }
                ::-webkit-scrollbar-thumb {
                    background: var(--scroll-thumb, var(--palette-divider));
                    border-radius: 6px;
                }
            </style>
            <div class="splitter">
                <slot></slot>
            </div>
        `;
    }

    #extractFixedBasis(pane) {
        const prop = this.#isVertical ? "height" : "width";
        const raw = pane?.style?.[prop];
        if (!raw) return null;
        const value = raw.trim();
        if (/^-?\d+(\.\d+)?(px|rem|em|vh|vw|vmin|vmax|ch)$/.test(value)) {
            return value;
        }
        return null;
    }

    /**
     * Called when the element is added to the DOM.
     * Inserts the SplitSlider components between panes.
     */
    connectedCallback() {
        // Use a MutationObserver to handle dynamically added panes.
        this.#observeSlottedPanes();

        // Get the initial panes and insert sliders.
        this.#insertSplitters();
    }

    disconnectedCallback() {
        if (this.#slotObserver) {
            this.#slotObserver.disconnect();
        }
    }

    /**
     * Uses a MutationObserver to react to changes in slotted children.
     * @private
     */
    #observeSlottedPanes() {
        if (!this.#slotObserver) {
            this.#slotObserver = new MutationObserver(() => this.#insertSplitters());
        } else {
            this.#slotObserver.disconnect();
        }
        this.#slotObserver.observe(this, { childList: true });
    }

    /**
     * Inserts SplitSlider elements between each SplitPane.
     * @private
     */
    #insertSplitters() {
        if (this.#slotObserver) {
            this.#slotObserver.disconnect();
        }

        const panes = this.querySelectorAll("globular-split-pane");

        // Clear existing sliders.
        this.#splitters.forEach(slider => slider.remove());
        this.#splitters = [];

        // Insert new sliders between panes.
        for (let i = 0; i < panes.length - 1; i++) {
            const pane1 = panes[i];
            const pane2 = panes[i + 1];
            const slider = new SplitSlider(pane1, pane2);
            this.insertBefore(slider, pane2);
            if (this.#isVertical) {
                slider.setVertical();
            } else {
                slider.setHorizontal();
            }
            const pane1Basis = this.#extractFixedBasis(pane1);
            const pane2Basis = this.#extractFixedBasis(pane2);
            if (!pane1.style.flex) pane1.style.flex = pane1Basis ? `0 0 ${pane1Basis}` : "1 1 0";
            if (!pane2.style.flex) pane2.style.flex = pane2Basis ? `0 0 ${pane2Basis}` : "1 1 0";
            this.#splitters.push(slider);
        }

        if (this.#slotObserver) {
            this.#slotObserver.observe(this, { childList: true });
        }
    }

    /**
     * Sets the splitter layout to vertical (column).
     */
    setVertical() {
        this.shadowRoot.querySelector(".splitter").style.flexDirection = "column";
        this.#splitters.forEach(slider => slider.setVertical());
        this.#isVertical = true;
        // Trigger a reflow to recalculate sizes.
        window.dispatchEvent(new Event('resize'));
    }

    /**
     * Sets the splitter layout to horizontal (row).
     */
    setHorizontal() {
        this.shadowRoot.querySelector(".splitter").style.flexDirection = "row";
        this.#splitters.forEach(slider => slider.setHorizontal());
        this.#isVertical = false;
        // Trigger a reflow to recalculate sizes.
        window.dispatchEvent(new Event('resize'));
    }
}

customElements.define('globular-split-view', SplitView);

/**
 * A draggable slider to resize two adjacent panes.
 * @element globular-split-slider
 */
export class SplitSlider extends HTMLElement {
    // Private fields for encapsulation.
    #panes; // An array [pane1, pane2]
    #isDragging = false;
    #isVertical = false;
    #containerRect = null;
    #pointerOffset = 0;
    #activePointerId = null;
    #isCollapsed = false;
    #lastSize = null;
    #toggleBtn = null;

    constructor(pane1, pane2) { // Removed 'view' as it's not needed
        super();
        this.attachShadow({ mode: 'open' });

        this.#panes = [pane1, pane2];

        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: flex;
                    align-items: stretch;
                    justify-content: center;
                    min-width: 5px;
                    min-height: 0;
                }
                .slider {
                    background-color: var(--surface-color);
                    transition: background-color 0.2s ease-in-out;
                    flex-shrink: 0; /* Prevents the slider from shrinking */
                    align-self: stretch;
                    position: relative;
                }
                .slider:hover {
                    background-color: darkgrey; /* Highlight on hover */
                }
                .horizontal-slider {
                    display: block;
                    height: 100%;
                    width: 0.3rem;
                    cursor: col-resize;
                }
                .vertical-slider {
                    display: block;
                    width: 100%;
                    height: 0.3rem;
                    cursor: row-resize;
                }
                .collapse-btn {
                    position: absolute;
                    top: 50%;
                    left: 0%;
                    transform: translate(-50%, -50%);
                    width: 20px;
                    height: 20px;
                    border-radius: 50%;
                    border: 1px solid var(--palette-divider);
                    background: var(--surface-elevated-color, var(--surface-color));
                    color: var(--primary-text-color);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 0.8rem;
                    cursor: pointer;
                    z-index: 2;
                }
            </style>
            <div class="slider horizontal-slider">
                <button class="collapse-btn" title="Toggle left pane" style="z-index: 10000;"></button>
            </div>
        `;

        this.slider = this.shadowRoot.querySelector(".slider");
        this.#toggleBtn = this.shadowRoot.querySelector(".collapse-btn");

        // Use pointer events for robust drag handling.
        this.slider.addEventListener('pointerdown', this.#onPointerDown);
        if (this.#toggleBtn) {
            this.#toggleBtn.addEventListener("click", (evt) => {
                evt.stopPropagation();
                this.#toggleCollapse();
            });
            this.#updateToggleIcon();
        }
    }

    /**
     * Sets the slider to vertical mode for column layout.
     */
    setVertical() {
        this.slider.classList.remove("horizontal-slider");
        this.slider.classList.add("vertical-slider");
        this.slider.style.cursor = "row-resize";
        this.#isVertical = true;
        this.#updateToggleIcon();
    }

    /**
     * Sets the slider to horizontal mode for row layout.
     */
    setHorizontal() {
        this.slider.classList.remove("vertical-slider");
        this.slider.classList.add("horizontal-slider");
        this.slider.style.cursor = "col-resize";
        this.#isVertical = false;
        this.#updateToggleIcon();
    }

    /**
     * Handles the pointerdown event to start dragging.
     * @private
     * @param {PointerEvent} e
     */
    #onPointerDown = (e) => {
        if (this.#toggleBtn && (e.target === this.#toggleBtn || this.#toggleBtn.contains(e.target))) {
            return;
        }
        e.preventDefault(); // Prevent text selection
        this.#isDragging = true;
        this.#containerRect = this.parentElement?.getBoundingClientRect() || null;
        const sliderRect = this.getBoundingClientRect();
        this.#pointerOffset = this.#isVertical ? e.clientY - sliderRect.top : e.clientX - sliderRect.left;
        this.#activePointerId = e.pointerId;
        this.slider.setPointerCapture(e.pointerId);

        // Add move and up listeners to the whole document body for reliability.
        document.body.addEventListener('pointermove', this.#onPointerMove);
        document.body.addEventListener('pointerup', this.#onPointerUp);
        
        // Add a class to the body to manage the cursor during drag.
        document.body.style.userSelect = 'none';
        document.body.style.cursor = this.#isVertical ? 'row-resize' : 'col-resize';
    }

    /**
     * Handles the pointermove event to resize the panes.
     * @private
     * @param {PointerEvent} e
     */
    #onPointerMove = (e) => {
        if (!this.#isDragging) return;

        if (!this.#containerRect) {
            this.#containerRect = this.parentElement?.getBoundingClientRect() || null;
            if (!this.#containerRect) return;
        }

        const paneToResize = this.#panes[0];
        const siblingPane = this.#panes[1];
        if (!paneToResize || !siblingPane) return;

        const sliderRect = this.getBoundingClientRect();
        const sliderSize = this.#isVertical ? sliderRect.height : sliderRect.width;
        const minPrimary = Number(paneToResize.getAttribute("min-size")) || 120;
        const minSecondary = Number(siblingPane.getAttribute("min-size")) || 120;

        let newPos;
        if (this.#isVertical) {
            newPos = e.clientY - this.#containerRect.top - this.#pointerOffset;
            const maxSize = this.#containerRect.height - sliderSize - minSecondary;
            newPos = Math.min(Math.max(newPos, minPrimary), maxSize);
        } else {
            newPos = e.clientX - this.#containerRect.left - this.#pointerOffset;
            const maxSize = this.#containerRect.width - sliderSize - minSecondary;
            newPos = Math.min(Math.max(newPos, minPrimary), maxSize);
        }

        this.#applyPaneSize(newPos);
        this.#isCollapsed = false;
        this.#lastSize = paneToResize.getBoundingClientRect()[this.#isVertical ? "height" : "width"];
        this.#updateToggleIcon();
    }

    /**
     * Handles the pointerup event to stop dragging.
     * @private
     */
    #onPointerUp = () => {
        this.#isDragging = false;
        this.#containerRect = null;
        
        // Remove the move and up listeners.
        document.body.removeEventListener('pointermove', this.#onPointerMove);
        document.body.removeEventListener('pointerup', this.#onPointerUp);

        if (this.#activePointerId !== null) {
            this.slider.releasePointerCapture(this.#activePointerId);
            this.#activePointerId = null;
        }
        
        // Clean up body styles.
        document.body.style.userSelect = '';
        document.body.style.cursor = 'default';
    }

    #applyPaneSize(size) {
        const pane = this.#panes[0];
        if (!pane) return;
        const sibling = this.#panes[1];
        const safeSize = Math.max(0, size);

        pane.style.transition = "flex-basis 200ms ease, width 200ms ease, height 200ms ease";
        requestAnimationFrame(() => {
            pane.style.flex = `0 0 ${safeSize}px`;
            if (this.#isVertical) {
                pane.style.height = `${safeSize}px`;
                pane.style.width = "";
            } else {
                pane.style.width = `${safeSize}px`;
                pane.style.height = "";
            }
        });
        clearTimeout(pane._splitAnimationTimeout);
        pane._splitAnimationTimeout = setTimeout(() => {
            pane.style.transition = "";
        }, 220);

        if (sibling) {
            sibling.style.flex = "1 1 0";
            sibling.style.width = "";
            sibling.style.height = "";
        }
    }

    #toggleCollapse() {
        const pane = this.#panes[0];
        if (!pane) return;
        if (!this.#isCollapsed) {
            const current = pane.getBoundingClientRect()[this.#isVertical ? "height" : "width"];
            this.#lastSize = current > 0 ? current : (Number(pane.getAttribute("min-size")) || 240);
            this.#applyPaneSize(0);
            this.#isCollapsed = true;
            if (this.#toggleBtn) this.#toggleBtn.style.left = "20px";
        } else {
            const minSize = Number(pane.getAttribute("min-size")) || 120;
            const restored = Math.max(minSize, this.#lastSize || minSize);
            this.#applyPaneSize(restored);
            this.#isCollapsed = false;
            if (this.#toggleBtn) this.#toggleBtn.style.left = "50%";
        }
        this.#updateToggleIcon();
    }

    #updateToggleIcon() {
        if (!this.#toggleBtn) return;
        const expandedIcon = this.#isVertical ? "∧" : "⟨";
        const collapsedIcon = this.#isVertical ? "∨" : "⟩";
        this.#toggleBtn.textContent = this.#isCollapsed ? collapsedIcon : expandedIcon;
        this.#toggleBtn.title = this.#isCollapsed ? "Show pane" : "Hide pane";
    }
}

customElements.define('globular-split-slider', SplitSlider);

/**
 * A content pane for a SplitView.
 * @element globular-split-pane
 * @slot The content to be displayed inside the pane.
 */
export class SplitPane extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });

        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: flex;
                    flex: 1 1 0;
                    min-width: 0;
                    min-height: 0;
                    position: relative;
                }
                .splitter__pane {
                    flex: 1 1 auto;
                    position: relative;
                    min-width: 0;
                    min-height: 0;
                    display: flex;
                    flex-direction: column;
                    color: var(--primary-text-color);
                    overflow: hidden;
                }
                #content {
                    flex: 1 1 auto;
                    position: relative;
                    overflow: hidden;
                    min-width: 0;
                    min-height: 0;
                }
                ::-webkit-scrollbar {
                    width: 10px;
                }
                ::-webkit-scrollbar-track {
                    background: var(--scroll-track, var(--surface-color));
                }
                ::-webkit-scrollbar-thumb {
                    background: var(--scroll-thumb, var(--palette-divider));
                    border-radius: 6px;
                }
                /* Style for slotted content */
                ::slotted(*) {
                    height: 100%;
                }
            </style>
            <div class="splitter__pane">
                <div id="content">
                    <slot></slot>
                </div>
            </div>
        `;
    }

    /**
     * Sets the width of the pane.
     * @param {number} width The width in pixels.
     */
    setWidth(width) {
        this.style.width = `${width}px`;
    }

    /**
     * Sets the height of the pane.
     * @param {number} height The height in pixels.
     */
    setHeight(height) {
        this.style.height = `${height}px`;
    }
}

customElements.define('globular-split-pane', SplitPane);
