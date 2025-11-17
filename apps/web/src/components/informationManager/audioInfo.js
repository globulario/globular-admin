// Import necessary dependencies
import { AudioInfoEditor } from "./audioInfomationsEditor"; // Assuming this is an existing class
import { Backend } from "../../backend/backend"; // Assuming displaySuccess is also from backend.js
import { displayError, displaySuccess, displayMessage} from "../../backend/ui/notify";
import '@polymer/paper-button/paper-button.js'; // Needed for paper-button
import '@polymer/iron-icon/iron-icon.js'; // Often needed implicitly for paper-button, but good to ensure
import { deleteAudio } from "../../backend/media/title";


// --- Utility Function (kept as global as in original) ---
function toHoursAndMinutes(totalSeconds) {
    const totalMinutes = Math.floor(totalSeconds / 60);

    const seconds = totalSeconds % 60;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    return { h: hours, m: minutes, s: seconds };
}


/**
 * Displays basic audio file information and provides actions for editing and deletion.
 */
export class AudioInfo extends HTMLElement {
    // Private instance properties
    _audio = null; // The audio object to display
    _isShort = false; // Controls display of action buttons (e.g., in a condensed view)
    _imageElement = null;
    _titleDiv = null;
    _artistDiv = null;
    _albumDiv = null;
    _albumArtistDiv = null;
    _genreDiv = null;
    _yearDiv = null;
    _trackDiv = null;
    _durationDiv = null;
    _editButton = null;
    _deleteButton = null;

    /**
     * Optional callback fired when the audio info is successfully deleted.
     * @type {Function | null}
     */
    ondelete = null;

    /**
     * Constructor for the AudioInfo custom element.
     * Initializes the shadow DOM and sets up the basic HTML structure.
     */
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });

        // Initial HTML structure. Actual data will be rendered via _render()
        this.shadowRoot.innerHTML = `
            <style>
                #container {
                    display: flex;
                    flex-direction: column;
                    color: var(--primary-text-color);
                    padding: 15px; /* Added padding for better spacing */
                    box-sizing: border-box; /* Ensure padding is included in element's total width/height */
                }

                .info-details {
                    display: table;
                    flex-grow: 1;
                    padding-left: 20px;
                    width: 100%; /* Ensure table takes full width */
                    box-sizing: border-box;
                    border-collapse: separate; /* Required for border-spacing */
                    border-spacing: 0 5px; /* Vertical spacing between rows */
                }

                .info-row {
                    display: table-row;
                }

                .info-label {
                    display: table-cell;
                    font-weight: 500; /* Slightly bolder for labels */
                    padding-right: 15px; /* Space between label and value */
                    vertical-align: top; /* Align labels to the top */
                    white-space: nowrap; /* Prevent label text from wrapping */
                }

                .info-value {
                    display: table-cell;
                    word-break: break-word; /* Allow long values to wrap */
                }

                img {
                    width: 256px;
                    height: auto; /* Maintain aspect ratio */
                    object-fit: contain; /* Ensure image fits without cropping */
                    border-radius: 8px; /* Slightly rounded corners for aesthetics */
                    margin-bottom: 20px; /* Space below image */
                    align-self: center; /* Center the image in column flex */
                }

                .action-div {
                    display: flex;
                    justify-content: flex-end; /* Align buttons to the right */
                    gap: 10px; /* Space between buttons */
                    padding-top: 20px; /* Space above buttons */
                    border-top: 1px solid var(--palette-divider, #ccc); /* Separator line */
                    margin-top: 20px;
                }

                paper-button {
                    /* Custom styles for paper-button if needed */
                    --paper-button-flat-keyboard-focus: {
                        background-color: var(--primary-light-color);
                    };
                    background-color: var(--primary-color);
                    color: var(--on-primary-color);
                    padding: 8px 16px;
                    border-radius: 4px;
                }
                paper-button:hover {
                    background-color: var(--primary-dark-color);
                }
            </style>
            <div id="container">
                <div>
                    <img id="image" alt="Audio Cover Art">
                </div>
                <div class="info-details">
                    <div class="info-row">
                        <div class="info-label">Title:</div>
                        <div id="title-div" class="info-value"></div>
                    </div>
                    <div class="info-row">
                        <div class="info-label">Artist:</div>
                        <div id="artist-div" class="info-value"></div>
                    </div>
                    <div class="info-row">
                        <div class="info-label">Album:</div>
                        <div id="album-div" class="info-value"></div>
                    </div>
                    <div class="info-row">
                        <div class="info-label">Album Artist:</div>
                        <div id="album-artist-div" class="info-value"></div>
                    </div>
                    <div class="info-row">
                        <div class="info-label">Genre:</div>
                        <div id="genre-div" class="info-value"></div>
                    </div>
                    <div class="info-row">
                        <div class="info-label">Year:</div>
                        <div id="year-div" class="info-value"></div>
                    </div>
                    <div class="info-row">
                        <div class="info-label">Track:</div>
                        <div id="track-div" class="info-value"></div>
                    </div>
                    <div class="info-row">
                        <div class="info-label">Duration:</div>
                        <div id="duration-div" class="info-value"></div>
                    </div>
                </div>
                <div class="action-div">
                    <paper-button id="edit-indexation-btn">Edit</paper-button>
                    <paper-button id="delete-indexation-btn">Delete</paper-button>
                </div>
            </div>
        `;
        this._getDomReferences(); // Get references to elements once
    }

    /**
     * Called when the element is inserted into the document's DOM.
     * No specific actions needed here beyond what the constructor and setter do.
     */
    connectedCallback() {
        this._bindEventListeners(); // Bind event listeners
        this._render(); // Initial render or re-render if data set before connection
    }

    /**
     * Called when the element is removed from the document's DOM.
     * Clean up event listeners or resources here if necessary.
     */
    disconnectedCallback() {
        // No specific cleanup needed for this simple component,
        // as event listeners are bound to internal elements and removed with element.
    }

    /**
     * Gets references to the various DOM elements used for displaying audio info.
     * This avoids repeated `querySelector` calls.
     * @private
     */
    _getDomReferences() {
        this._imageElement = this.shadowRoot.querySelector("#image");
        this._titleDiv = this.shadowRoot.querySelector("#title-div");
        this._artistDiv = this.shadowRoot.querySelector("#artist-div");
        this._albumDiv = this.shadowRoot.querySelector("#album-div");
        this._albumArtistDiv = this.shadowRoot.querySelector("#album-artist-div");
        this._genreDiv = this.shadowRoot.querySelector("#genre-div");
        this._yearDiv = this.shadowRoot.querySelector("#year-div");
        this._trackDiv = this.shadowRoot.querySelector("#track-div");
        this._durationDiv = this.shadowRoot.querySelector("#duration-div");
        this._editButton = this.shadowRoot.querySelector("#edit-indexation-btn");
        this._deleteButton = this.shadowRoot.querySelector("#delete-indexation-btn");
        this._actionDiv = this.shadowRoot.querySelector(".action-div");
    }

    /**
     * Binds event listeners to the action buttons (Edit and Delete).
     * @private
     */
    _bindEventListeners() {
        if (this._editButton) {
            this._editButton.addEventListener('click', this._handleEditClick.bind(this));
        }
        if (this._deleteButton) {
            this._deleteButton.addEventListener('click', this._handleDeleteClick.bind(this));
        }
    }

    /**
     * Sets the audio object to display in the component.
     * Triggers a re-render of the component with the new data.
     * @param {Object} audio - The audio object containing information.
     */
    set audio(audio) {
        if (this._audio !== audio) { // Only re-render if data has changed
            this._audio = audio;
            this._render();
        }
    }

    /**
     * Gets the current audio object displayed by the component.
     * @returns {Object | null} The current audio object.
     */
    get audio() {
        return this._audio;
    }

    /**
     * Sets whether the view should be in "short" mode, hiding action buttons.
     * @param {boolean} isShort - True to hide action buttons, false to show.
     */
    set isShort(isShort) {
        this._isShort = isShort;
        this._render(); // Re-render to apply the display change
    }

    /**
     * Renders or re-renders the component's content based on the `_audio` property.
     * @private
     */
    _render() {
        // If no audio data, display a placeholder or hide content
        if (!this._audio) {
            // Optional: Clear content or display "No data" message
            // this.shadowRoot.innerHTML = '<p>No audio information to display.</p>';
            return;
        }

        // Update image source
        this._imageElement.src = this._audio.getPoster().getContenturl() || 'placeholder.png'; // Fallback for missing image
        this._imageElement.alt = `Cover art for ${this._audio.getTitle()}`;

        // Update text content for each info field
        this._titleDiv.textContent = this._audio.getTitle() || 'N/A';
        this._artistDiv.textContent = this._audio.getArtist() || 'N/A';
        this._albumDiv.textContent = this._audio.getAlbum() || 'N/A';
        this._albumArtistDiv.textContent = this._audio.getAlbumartist() || 'N/A';
        this._genreDiv.textContent = this._audio.getGenresList().join(" / ") || 'N/A';
        this._yearDiv.textContent = this._audio.getYear() ? String(this._audio.getYear()) : 'N/A';
        this._trackDiv.textContent = this._audio.getTracknumber() ? String(this._audio.getTracknumber()) : 'N/A';

        // Format and display duration
        const durationSeconds = this._audio.getDuration();
        const duration = toHoursAndMinutes(durationSeconds);
        this._durationDiv.textContent = `${duration.m}:${String(duration.s).padStart(2, '0')}`; // Ensure seconds are two digits

        // Handle visibility of action buttons based on `isShort` and authentication status
        const token = sessionStorage.getItem("__globular_token__");
        const isLoggedIn = (token && token !== "undefined" && token !== "");

        if (this._actionDiv) {
            this._actionDiv.style.display = this._isShort ? "none" : "flex"; // Hide if isShort is true

            if (this._editButton) {
                this._editButton.style.display = isLoggedIn ? "" : "none";
            }
            if (this._deleteButton) {
                this._deleteButton.style.display = isLoggedIn ? "" : "none";
            }
        }
    }

    /**
     * Handles the click event for the Edit button.
     * Displays the AudioInfoEditor.
     * @private
     */
    _handleEditClick() {
        if (!this._audio) return;

        const editor = new AudioInfoEditor(this._audio, this); // Pass current audio and this instance
        const parent = this.parentNode;

        if (parent) {
            parent.removeChild(this); // Remove this component
            parent.appendChild(editor); // Append the editor component
            displayMessage("Edit mode enabled.", 2000); // Inform user
        } else {
            console.warn("AudioInfo: Parent node not found for editing.");
            displayError("Cannot open editor: Component not attached to DOM.", 3000);
        }
    }

    /**
     * Handles the click event for the Delete button.
     * Displays a confirmation dialog before deleting the audio indexation.
     * @private
     */
    _handleDeleteClick() {
        if (!this._audio) return;

        // Use a more structured dialog approach
        const toast = displayMessage(`
            <style>
                #delete-audio-dialog {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    padding: 15px;
                }
                #delete-audio-dialog p {
                    font-style: italic;
                    max-width: 300px;
                    text-align: center;
                    margin-bottom: 10px;
                }
                #delete-audio-dialog img {
                    width: 185px; /* Adjusted to approximate original size */
                    height: auto;
                    object-fit: contain;
                    padding-top: 10px;
                    padding-bottom: 15px;
                }
                #delete-audio-dialog .dialog-actions {
                    display: flex;
                    justify-content: flex-end;
                    gap: 10px;
                    width: 100%;
                    margin-top: 20px;
                }
            </style>
            <div id="delete-audio-dialog">
                <div>You're about to delete indexation:</div>
                <p id="title-type"></p>
                <img id="title-poster"> </img>
                <div>Is that what you want to do?</div>
                <div class="dialog-actions">
                    <paper-button id="delete-audio-cancel-btn">Cancel</paper-button>
                    <paper-button id="delete-audio-ok-btn">Ok</paper-button>
                </div>
            </div>
            `, 60 * 1000 // 60 seconds timeout
        );

        const dialogTitleType = toast.toastElement.querySelector("#title-type");
        const dialogTitlePoster = toast.toastElement.querySelector("#title-poster");
        const okBtn = toast.toastElement.querySelector("#delete-audio-ok-btn");
        const cancelBtn = toast.toastElement.querySelector("#delete-audio-cancel-btn");

        // Populate dialog content
        dialogTitleType.textContent = this._audio.getTitle() || "N/A";
        dialogTitlePoster.src = this._audio.getPoster().getContenturl() || 'placeholder.png';


        cancelBtn.addEventListener('click', () => {
            toast.hideToast();
        });

        okBtn.addEventListener('click', async () => {
            toast.hideToast();
            if (!this._audio) return; // Double-check audio exists

            try {

                await deleteAudio( this._audio.getId());

                displaySuccess(`"${this._audio.getTitle()}" was deleted successfully!`, 3000);
                Backend.eventHub.publish(`_delete_infos_${ this._audio.getId()}_evt`, {}, true); // Publish deletion event

                if (this.parentNode) {
                    this.parentNode.removeChild(this); // Remove component from DOM
                }

                if (this.ondelete) {
                    this.ondelete(); // Call optional ondelete callback
                }
            } catch (err) {
                displayError(`Failed to delete audio info: ${err.message}`, 3000);
            }
        });
    }
}

customElements.define('globular-audio-info', AudioInfo);
