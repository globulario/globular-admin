import '@polymer/iron-icon/iron-icon.js'; // Needed for iron-icon
import { listToString } from '../utility'; // Assuming listToString is a utility function

/**
 * Displays basic role information.
 */
export class RoleInfo extends HTMLElement {
    // Private instance property to hold the role data.
    _role = null;

    /**
     * Creates an instance of RoleInfo.
     * Initializes the shadow DOM.
     */
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
    }

    /**
     * Called when the element is inserted into the document's DOM.
     * This is the ideal place to perform the initial rendering of the component.
     */
    connectedCallback() {
        this._render();
    }

    /**
     * Sets the role data for the component.
     * This method triggers the re-rendering of the role's information
     * if the provided data is different from the current.
     * @param {Object} role - The role object containing display data.
     */
    set role(role) {
        // Only update and re-render if the new role object is different.
        if (this._role !== role) {
            this._role = role;
            this._render(); // Re-render the component with the new data.
        }
    }

    /**
     * Gets the current role data.
     * @returns {Object | null} The current role object.
     */
    get role() {
        return this._role;
    }

    /**
     * Renders the component's HTML content into the shadow DOM.
     * This method is called initially in `connectedCallback` and whenever
     * the `role` property is updated.
     * @private
     */
    _render() {
        // If no role data, display a placeholder message.
        if (!this._role) {
            this.shadowRoot.innerHTML = `
                <style>
                    #container {
                        display: flex;
                        color: var(--primary-text-color);
                        padding: 10px;
                    }
                </style>
                <div id="container">
                    <p>No role data available.</p>
                </div>
            `;
            return;
        }

        this.shadowRoot.innerHTML = `
            <style>
                #container {
                    display: flex;
                    color: var(--primary-text-color);
                    padding: 15px; /* Added padding for overall spacing */
                    gap: 20px; /* Space between icon and info table */
                    align-items: flex-start; /* Align icon to top of info table */
                }

                .icon-container iron-icon {
                    height: 40px;
                    width: 40px;
                    padding-left: 15px; /* Original padding */
                    flex-shrink: 0; /* Prevent icon from shrinking */
                    color: var(--primary-color); /* A nice color for the icon */
                }

                .info-table {
                    display: table;
                    flex-grow: 1;
                    /* Removed padding-left from here as gap on container handles it */
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
                <div class="icon-container">
                    <iron-icon id="icon" icon="notification:enhanced-encryption"></iron-icon>
                </div>
                <div class="info-table">
                    <div class="info-row">
                        <div class="info-label">Id:</div>
                        <div class="info-value">${this._role.getId()}</div>
                    </div>
                    <div class="info-row">
                        <div class="info-label">Name:</div>
                        <div class="info-value">${this._role.getName()}</div>
                    </div>
                    <div class="info-row">
                        <div class="info-label">Accounts:</div>
                        <div class="info-value">${listToString(this._role.getMembersList())}</div>
                    </div>
                </div>
            </div>
        `;
    }
}

customElements.define('globular-role-info', RoleInfo);