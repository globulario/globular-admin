import { ShareResourceWizard } from "./shareResourceWizard"; // Assuming ShareResourceWizard is a custom element
import '@polymer/iron-icon/iron-icon.js'; // Needed for iron-icon
import '@polymer/iron-icons/social-icons.js'; // For social:share icon

/**
 * Custom element displaying a share icon that, when clicked,
 * initiates a resource sharing wizard.
 */
export class ShareResourceMenu extends HTMLElement {
    // Private instance properties
    _view = null; // The parent view component where the menu is displayed (context for wizard)
    _files = []; // The array of files to be shared

    // DOM element references
    _shareResourceButton = null;

    /**
     * Constructor for the ShareResourceMenu custom element.
     * @param {HTMLElement} view - The parent view component context.
     */
    constructor(view) {
        super();
        this.attachShadow({ mode: 'open' });
        this._view = view; // Store the view context
        // Initial rendering in connectedCallback
    }

    /**
     * Called when the element is inserted into the document's DOM.
     * Performs initial rendering and sets up event listeners.
     */
    connectedCallback() {
        this._renderInitialStructure();
        this._getDomReferences();
        this._bindEventListeners();
    }

    /**
     * Renders the initial HTML structure of the share resource menu.
     * @private
     */
    _renderInitialStructure() {
        this.shadowRoot.innerHTML = `
            <style>
                #container {
                    display: inline-flex; /* Use inline-flex to wrap content tightly */
                    align-items: center;
                    justify-content: center;
                }

                #share-resource-btn {
                    height: 18px; /* Icon size */
                    width: 18px; /* Icon size */
                    color: var(--primary-text-color); /* Default icon color */
                }

                #share-resource-btn:hover {
                    cursor: pointer;
                    color: var(--primary-color); /* Highlight on hover */
                }
            </style>
            <div id="container">
                <iron-icon id="share-resource-btn" icon="social:share" title="Share Resource"></iron-icon>
            </div>
        `;
    }

    /**
     * Retrieves references to all necessary DOM elements.
     * @private
     */
    _getDomReferences() {
        this._shareResourceButton = this.shadowRoot.querySelector("#share-resource-btn");
    }

    /**
     * Binds event listeners to interactive elements.
     * @private
     */
    _bindEventListeners() {
        if (this._shareResourceButton) {
            this._shareResourceButton.addEventListener('click', this._handleShareButtonClick.bind(this));
        }
    }

    /**
     * Sets the array of files to be shared.
     * @param {Array<Object>} files - An array of file objects.
     */
    setFiles(files) {
        this._files = files;
    }

    /**
     * Handles the click event for the share button.
     * Creates and displays the ShareResourceWizard.
     * @param {Event} evt - The click event.
     * @private
     */
    _handleShareButtonClick(evt) {
        evt.stopPropagation(); // Prevent event from bubbling up and causing unintended actions

        // Create a new instance of the ShareResourceWizard
        // Pass the files to be shared and the view context
        const shareResourceWizard = new ShareResourceWizard(this._files, this._view);

        // Show the wizard (assuming it has a show() method that appends it to the DOM)
        shareResourceWizard.show();
    }
}

customElements.define('globular-share-resource-menu', ShareResourceMenu);