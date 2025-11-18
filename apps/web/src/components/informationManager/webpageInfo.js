// No specific Polymer imports needed directly from this code, but common ones might be implicitly available.

/**
 * Displays basic webpage information including a thumbnail, ID, and name.
 */
export class WebpageInfo extends HTMLElement {
    // Private instance property to hold the webpage data.
    _webpage = null;

    /**
     * Constructor for the WebpageInfo custom element.
     * Initializes the shadow DOM.
     * Avoids data-dependent rendering here.
     */
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
    }

    /**
     * Called when the element is inserted into the document's DOM.
     * This is the ideal place to perform initial rendering of the component.
     */
    connectedCallback() {
        this._render();
    }

    /**
     * Sets the webpage data for the component.
     * This method will trigger the re-rendering of the webpage's information
     * if the provided data is different from the current.
     * @param {Object} webpage - The webpage object containing display data (e.g., { thumbnail: "...", _id: "...", name: "..." }).
     */
    set webpage(webpage) {
        // Only update and re-render if the new webpage object is different.
        if (this._webpage !== webpage) {
            this._webpage = webpage;
            this._render(); // Re-render the component with the new data.
        }
    }

    /**
     * Gets the current webpage data.
     * @returns {Object | null} The current webpage object.
     */
    get webpage() {
        return this._webpage;
    }

    /**
     * Renders the component's HTML content into the shadow DOM.
     * This method is called initially in `connectedCallback` and whenever
     * the `webpage` property is updated.
     * @private
     */
    _render() {
        // If no webpage data, display a placeholder message.
        if (!this._webpage) {
            this.shadowRoot.innerHTML = `
                <style>
                    #container {
                        display: flex;
                        color: var(--primary-text-color);
                        padding: 10px;
                    }
                </style>
                <div id="container">
                    <p>No webpage data available.</p>
                </div>
            `;
            return;
        }

        this.shadowRoot.innerHTML = `
            <style>
                #container {
                    display: flex;
                    color: var(--primary-text-color);
                    padding: 15px; /* Overall padding */
                    gap: 20px; /* Space between image and info table */
                    align-items: flex-start; /* Align content to the top */
                }

                .image-box {
                    width: 120px;
                    height: 120px; /* Fixed height for consistency */
                    overflow: hidden;
                    flex-shrink: 0; /* Prevent image box from shrinking */
                    border-radius: 8px; /* Rounded corners for the image box */
                    box-shadow: var(--shadow-elevation-2dp); /* Subtle initial shadow */
                    transition: all 0.3s ease-in-out; /* Smooth transitions for hover effects */
                }

                .image-box img {
                    width: 100%;
                    height: 100%; /* Image fills its container */
                    object-fit: cover; /* Cover the area, cropping if necessary */
                    display: block; /* Remove extra space below image */
                }

                /* Simplified hover effect for the image box */
                .image-box:hover {
                    transform: scale(1.05); /* Slightly enlarge */
                    box-shadow: var(--shadow-elevation-6dp); /* More pronounced shadow */
                    cursor: pointer;
                    /* Removed fixed positioning and large size changes to avoid disruptive layout shifts */
                }

                /* Scrollbar styles (inherited from global styles often) */
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

                .info-table {
                    display: table;
                    flex-grow: 1; /* Table takes remaining space */
                    border-collapse: separate; /* Ensure table-cell styling works */
                    border-spacing: 0 5px; /* Vertical spacing between rows */
                    width: 100%; /* Ensure table takes available width */
                }

                .info-row {
                    display: table-row;
                }

                .info-label {
                    display: table-cell;
                    font-weight: 500; /* Slightly bolder for labels */
                    padding-right: 15px; /* Space between label and value */
                    vertical-align: top; /* Align labels to top if content is long */
                    white-space: nowrap; /* Prevent labels from wrapping */
                }

                .info-value {
                    display: table-cell;
                    word-break: break-word; /* Allow long values to wrap */
                }
            </style>
            <div id="container">
                <div class="image-box">
                    <img src="${this._webpage.thumbnail}" alt="Webpage Thumbnail">
                </div>
                <div class="info-table">
                    <div class="info-row">
                        <div class="info-label">Id:</div>
                        <div class="info-value">${this._webpage._id}</div>
                    </div>
                    <div class="info-row">
                        <div class="info-label">Name:</div>
                        <div class="info-value">${this._webpage.name}</div>
                    </div>
                </div>
            </div>
        `;
    }
}

// Define the custom element
customElements.define('globular-webpage-info', WebpageInfo);
