/**
 * Extracts a pixel value from a CSS style string (e.g., '10px').
 * @param {string} styleValue The CSS string to parse.
 * @returns {number} The parsed pixel value or 0 if invalid.
 */
const extractPxValue = (styleValue) => {
    const match = styleValue.match(/^([0-9.]+)px$/);
    return match ? parseFloat(match[1]) : 0;
};

/**
 * Extracts a computed style value from an element and converts it to a number.
 * @param {HTMLElement} element The element.
 * @param {string} style The CSS style property name.
 * @returns {number} The value in pixels.
 */
const extractComputedStyleValue = (element, style) => {
    const computedStyle = window.getComputedStyle(element);
    return extractPxValue(computedStyle[style]);
};

/**
 * Calculates the total horizontal padding, border, and margin of an element.
 * @param {HTMLElement} element The element.
 * @returns {number} The total horizontal extra width.
 */
const getExtraWidth = (element) => {
    const style = window.getComputedStyle(element);
    return extractPxValue(style.paddingLeft) +
           extractPxValue(style.paddingRight) +
           extractPxValue(style.borderLeftWidth) +
           extractPxValue(style.borderRightWidth) +
           extractPxValue(style.marginLeft) +
           extractPxValue(style.marginRight);
};

/**
 * Calculates the total vertical padding, border, and margin of an element.
 * @param {HTMLElement} element The element.
 * @returns {number} The total vertical extra height.
 */
const getExtraHeight = (element) => {
    const style = window.getComputedStyle(element);
    return extractPxValue(style.paddingTop) +
           extractPxValue(style.paddingBottom) +
           extractPxValue(style.borderTopWidth) +
           extractPxValue(style.borderBottomWidth) +
           extractPxValue(style.marginTop) +
           extractPxValue(style.marginBottom);
};

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

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });

        this.shadowRoot.innerHTML = `
            <style>
                .splitter {
                    display: flex;
                    width: 100%;
                    height: 100%; /* Ensure it takes up full height */
                }
                /* Slot styles are fine, but could be moved to host if desired */
                ::slotted(globular-split-pane) {
                    overflow: auto;
                }
                ::-webkit-scrollbar {
                    width: 5px;
                    height: 5px;
                }
                ::-webkit-scrollbar-track {
                    background: var(--surface-color);
                }
                ::-webkit-scrollbar-thumb {
                    background: var(--palette-divider);
                }
            </style>
            <div class="splitter">
                <slot></slot>
            </div>
        `;
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

    /**
     * Uses a MutationObserver to react to changes in slotted children.
     * @private
     */
    #observeSlottedPanes() {
        const slot = this.shadowRoot.querySelector('slot');
        const observer = new MutationObserver(() => this.#insertSplitters());
        observer.observe(slot, { childList: true });
    }

    /**
     * Inserts SplitSlider elements between each SplitPane.
     * @private
     */
    #insertSplitters() {
        const panes = this.querySelectorAll("globular-split-pane");
        const splitterContainer = this.shadowRoot.querySelector(".splitter");

        // Clear existing sliders.
        this.#splitters.forEach(slider => slider.remove());
        this.#splitters = [];

        // Insert new sliders between panes.
        for (let i = 0; i < panes.length - 1; i++) {
            const pane1 = panes[i];
            const pane2 = panes[i + 1];
            const slider = new SplitSlider(pane1, pane2);
            this.insertBefore(slider, pane2);
            this.#splitters.push(slider);
        }
    }

    /**
     * Sets the splitter layout to vertical (column).
     */
    setVertical() {
        this.shadowRoot.querySelector(".splitter").style.flexDirection = "column";
        this.#splitters.forEach(slider => slider.setVertical());
        // Trigger a reflow to recalculate sizes.
        window.dispatchEvent(new Event('resize'));
    }

    /**
     * Sets the splitter layout to horizontal (row).
     */
    setHorizontal() {
        this.shadowRoot.querySelector(".splitter").style.flexDirection = "row";
        this.#splitters.forEach(slider => slider.setHorizontal());
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
    #lastPosition = { x: 0, y: 0 };

    constructor(panes, view) { // Removed 'view' as it's not needed
        super();
        this.attachShadow({ mode: 'open' });

        this.#panes = panes;

        this.shadowRoot.innerHTML = `
            <style>
                .slider {
                    background-color: var(--surface-color);
                    transition: background-color 0.2s ease-in-out;
                    flex-shrink: 0; /* Prevents the slider from shrinking */
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
            </style>
            <div class="slider horizontal-slider"></div>
        `;

        this.slider = this.shadowRoot.querySelector(".slider");

        // Use pointer events for robust drag handling.
        this.slider.addEventListener('pointerdown', this.#onPointerDown);
    }

    /**
     * Sets the slider to vertical mode for column layout.
     */
    setVertical() {
        this.slider.classList.remove("horizontal-slider");
        this.slider.classList.add("vertical-slider");
        this.slider.style.cursor = "row-resize";
        this.#isVertical = true;
    }

    /**
     * Sets the slider to horizontal mode for row layout.
     */
    setHorizontal() {
        this.slider.classList.remove("vertical-slider");
        this.slider.classList.add("horizontal-slider");
        this.slider.style.cursor = "col-resize";
        this.#isVertical = false;
    }

    /**
     * Handles the pointerdown event to start dragging.
     * @private
     * @param {PointerEvent} e
     */
    #onPointerDown = (e) => {
        e.preventDefault(); // Prevent text selection
        this.#isDragging = true;
        this.#lastPosition = { x: e.clientX, y: e.clientY };
        
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

        const deltaX = e.clientX - this.#lastPosition.x;
        const deltaY = e.clientY - this.#lastPosition.y;

        let paneToResize = this.#panes[0];
        let newFlexBasis;

        if (this.#isVertical) {
            newFlexBasis = paneToResize.offsetHeight + deltaY;
            paneToResize.style.flex = `0 0 ${newFlexBasis}px`;
        } else {
            newFlexBasis = paneToResize.offsetWidth + deltaX;
            paneToResize.style.flex = `0 0 ${newFlexBasis}px`;
        }
        
        // Update last position for the next move event.
        this.#lastPosition = { x: e.clientX, y: e.clientY };
    }

    /**
     * Handles the pointerup event to stop dragging.
     * @private
     */
    #onPointerUp = () => {
        this.#isDragging = false;
        
        // Remove the move and up listeners.
        document.body.removeEventListener('pointermove', this.#onPointerMove);
        document.body.removeEventListener('pointerup', this.#onPointerUp);
        
        // Clean up body styles.
        document.body.style.userSelect = '';
        document.body.style.cursor = 'default';
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
                .splitter__pane {
                    flex: 1 1 auto;
                    position: relative;
                    height: 100%;
                    width: 100%;
                    overflow: auto;
                    color: var(--primary-text-color);
                }
                #content {
                    position: absolute;
                    top: 0;
                    left: 0;
                    bottom: 0;
                    right: 0;
                    overflow: auto; /* Ensures slotted content can scroll */
                }
                ::-webkit-scrollbar {
                    width: 5px;
                    height: 5px;
                }
                ::-webkit-scrollbar-track {
                    background: var(--surface-color);
                }
                ::-webkit-scrollbar-thumb {
                    background: var(--palette-divider); 
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