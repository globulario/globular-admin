import getUuidByString from "uuid-by-string";
import { AccountController } from "../../backend/account"; // Assuming AccountController is promisified
import { Wizard } from "../wizard"; // Assuming Wizard is a custom element
import { randomUUID } from "../utility"; // Assuming randomUUID is a utility
import { Backend, displayError } from "../../backend/backend"; // Use Backend.authenticatedCall
import { CreateNotificationRqst, Notification, NotificationType } from "globular-web-client/resource/resource_pb"; // Assuming protos
import { GetResourcePermissionsRqst, Permissions, SetResourcePermissionsRqst } from "globular-web-client/rbac/rbac_pb"; // Assuming protos
import { GlobularSubjectsSelected } from "./subjectsSelected"; // Assuming custom element
import { GlobularSubjectsView } from "./subjectsView"; // Assuming custom element
import { GroupController } from "../../backend/group"; // Assuming GroupController is promisified
import { SharedSubjectsPermissions } from "./sharedSubjectPermissions"; // Assuming custom element

// Import global info display functions if they exist
import { showGlobalTitleInfo } from "../search/searchTitleCard"; // Assuming this is the global helper
import { showGlobalVideoInfo } from "../search/searchVideoCard"; // Assuming this is the global helper

// Polymer component imports (ensure these are loaded in parent context)
import '@polymer/iron-icon/iron-icon.js';
import '@polymer/paper-icon-button/paper-icon-button.js';
import '@polymer/paper-checkbox/paper-checkbox.js';
import '@polymer/paper-button/paper-button.js';
import '@polymer/paper-card/paper-card.js'; // For card styling if not base element


/**
 * Custom element implementing a multi-step wizard for sharing resources.
 * Allows selecting files, subjects, setting permissions, and reviewing summary.
 */
export class ShareResourceWizard extends HTMLElement {
    // Private instance properties
    _view = null; // The parent view context (e.g., FileExplorer)
    _files = []; // Files selected for sharing
    _wizard = null; // Wizard component instance
    _closeButton = null; // Header close button
    _titleSpan = null; // Header title span

    // Wizard pages and their content references
    _filesPage = null; // Page for file selection
    _subjectsPage = null; // Page for subject selection
    _permissionsPage = null; // Page for permission settings
    _summaryPage = null; // Page for summary review

    // Components within wizard pages
    _subjectsView = null;
    _selectedSubjects = null;
    _sharedSubjectsPermission = null;

    /**
     * Constructor for the ShareResourceWizard custom element.
     * @param {Array<Object>} files - The file objects to be shared.
     * @param {HTMLElement} view - The parent view component context.
     */
    constructor(files, view) {
        super();
        this.attachShadow({ mode: 'open' });
        this._files = files || [];
        this._view = view;
        // Initial rendering in connectedCallback
    }

    /**
     * Called when the element is inserted into the document's DOM.
     * Performs initial rendering, gets DOM references, and binds event listeners.
     */
    connectedCallback() {
        this._renderInitialStructure();
        this._getDomReferences();
        this._bindEventListeners();
        this._setupWizardPages(); // Setup wizard content
    }

    /**
     * Renders the initial HTML structure of the wizard.
     * @private
     */
    _renderInitialStructure() {
        this.shadowRoot.innerHTML = `
            <style>
                #container {
                    display: flex;
                    height: 100%;
                    flex-direction: column;
                    border-left: 1px solid var(--palette-divider);
                    border-right: 1px solid var(--palette-divider);
                    background-color: var(--surface-color);
                    color: var(--primary-text-color); /* Ensure text color */
                    box-shadow: var(--shadow-elevation-8dp); /* Stronger shadow for a wizard */
                    border-radius: 8px; /* Rounded corners */
                    overflow: hidden; /* Ensure content respects border-radius */
                }

                .header {
                    display: flex;
                    align-items: center;
                    color: var(--on-primary-color);
                    background-color: var(--palette-primary-accent);
                    padding: 8px 16px; /* Padding for header */
                    flex-shrink: 0; /* Prevent header from shrinking */
                }

                .header iron-icon {
                    padding-left: 10px;
                    color: var(--on-primary-color); /* Icon color on accent background */
                }
                .header paper-icon-button {
                    min-width: 40px;
                    color: var(--on-primary-color); /* Icon color on accent background */
                }

                .title-span {
                    flex-grow: 1;
                    font-size: 1.25rem;
                    font-weight: 500;
                    text-align: center; /* Center header title */
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .content-area {
                    display: flex;
                    flex-direction: column;
                    height: 100%;
                    flex-grow: 1;
                    overflow: hidden; /* Manage overflow of the wizard content */
                }

                /* General wizard page content styling */
                .globular-wizard-page {
                    display: flex;
                    flex-direction: column; /* Default to column for pages */
                    padding: 15px; /* Default padding for pages */
                    box-sizing: border-box;
                    height: 100%; /* Pages should fill container */
                    overflow-y: auto; /* Allow individual pages to scroll */
                }

                /* Specific styles for files page */
                .files-page-content {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 10px; /* Space between file cards */
                    justify-content: center; /* Center cards */
                }

                .file-card {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    width: 150px; /* Fixed width for file cards */
                    border: 1px solid var(--palette-divider);
                    padding: 5px;
                    border-radius: 4px;
                    background-color: var(--surface-color);
                    box-shadow: var(--shadow-elevation-2dp);
                }
                .file-card img {
                    height: 64px;
                    width: auto;
                    margin-top: 4px;
                    object-fit: contain;
                }
                .file-card .title-span {
                    font-size: .85rem;
                    padding: 2px;
                    display: block;
                    max-width: 100%;
                    word-break: break-all;
                    text-align: center;
                    white-space: normal; /* Allow name to wrap */
                    overflow: hidden;
                    text-overflow: ellipsis; /* For long names on multiple lines */
                }
                .file-card .file-info-header {
                    display: flex;
                    align-items: center;
                    width: 100%;
                    justify-content: space-between;
                }
                .file-card paper-checkbox {
                    --paper-checkbox-checked-color: var(--primary-color);
                    --paper-checkbox-checkmark-color: var(--on-primary-color);
                    --paper-checkbox-label-color: var(--primary-text-color);
                    margin-right: 5px; /* Space checkbox from text */
                }
                .file-card .wizard-file-infos-btn {
                    color: var(--primary-color);
                }


                /* Styles for subjects page */
                .subjects-page-content {
                    display: flex;
                    height: 100%;
                }
                globular-subjects-view {
                    height: 100%;
                    min-width: 250px;
                    border-right: 1px solid var(--palette-divider);
                    flex-grow: 1;
                    overflow-y: auto;
                }
                globular-subjects-selected {
                    height: 100%;
                    margin-left: 20px;
                    flex-grow: 2; /* Allow selected subjects to take more space */
                    overflow-y: auto;
                    border: 1px solid var(--palette-divider); /* Add border for clarity */
                    border-radius: 4px;
                    padding: 5px;
                }

                /* Styles for summary page */
                .summary-page-content {
                    display: flex;
                    height: 100%;
                }
                .summary-status-icon {
                    height: 64px;
                    width: 64px;
                    fill: var(--palette-success-main);
                    flex-shrink: 0;
                    margin-right: 20px; /* Space from content */
                }
                .summary-text-content {
                    display: flex;
                    flex-direction: column;
                    flex-grow: 1;
                    padding-left: 30px; /* Indent text content */
                    border-left: 1px solid var(--palette-divider); /* Separator */
                }
                .summary-text-content p {
                    margin: 5px 0; /* Adjust paragraph margins */
                    font-size: 1rem;
                    color: var(--primary-text-color);
                }
                .summary-list {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 10px; /* Space between list items */
                    padding: 10px 0;
                }
                .summary-list .infos img {
                    max-height: 64px;
                    max-width: 64px;
                    border-radius: 50%;
                }
                .summary-list .infos iron-icon {
                    width: 32px; height: 32px;
                }

                @media(max-width: 500px){
                    #container { /* Adjust container for mobile dialog */
                        width: calc(100vw - 20px);
                        left: 10px; right: 10px; top: 10px; bottom: 10px;
                        max-height: calc(100vh - 20px);
                        position: fixed;
                        transform: translate(-50%, -50%); /* Centering */
                    }
                    .subjects-page-content, .summary-page-content {
                        flex-direction: column;
                    }
                    globular-subjects-view {
                        border-right: none;
                        border-bottom: 1px solid var(--palette-divider);
                        max-width: 100%;
                        height: 200px; /* Fixed height for mobile subjects view */
                    }
                    globular-subjects-selected {
                        margin-left: 0; /* Remove left margin */
                        margin-top: 20px; /* Space from subjects view */
                        height: 150px; /* Fixed height for mobile selected subjects */
                    }
                    .summary-text-content {
                        border-left: none;
                        border-top: 1px solid var(--palette-divider); /* New separator for mobile */
                        padding-left: 0;
                        margin-left: 0;
                        margin-top: 20px;
                    }
                }
            </style>
            <div id="container">
                <div class="header">
                    <iron-icon icon="social:share"></iron-icon>
                    <span class="title-span">Share Resources Wizard</span>
                    <paper-icon-button id="close-button" icon="icons:close"></paper-icon-button>
                </div>
                <div class="content-area">
                    </div>
            </div>
        `;
    }

    /**
     * Retrieves references to all necessary DOM elements.
     * @private
     */
    _getDomReferences() {
        this._closeButton = this.shadowRoot.querySelector("#close-button");
        this._titleSpan = this.shadowRoot.querySelector(".title-span");
        this._contentArea = this.shadowRoot.querySelector(".content-area"); // Where wizard appends its pages
    }

    /**
     * Binds event listeners to interactive elements.
     * @private
     */
    _bindEventListeners() {
        if (this._closeButton) {
            this._closeButton.addEventListener('click', this._handleCloseButtonClick.bind(this));
        }
    }

    /**
     * Sets up the wizard pages and their content.
     * @private
     */
    _setupWizardPages() {
        this._wizard = new Wizard();
        this._wizard.style.flexGrow = 1;
        this._wizard.style.height = "100%"; // Wizard should fill content area
        this._contentArea.appendChild(this._wizard);

        // --- Page 1: File Selection ---
        this._filesPage = document.createElement('div');
        this._filesPage.classList.add('globular-wizard-page', 'files-page-content');
        this._populateFilesPage(this._filesPage); // Populate with file cards
        this._wizard.appendPage(this._filesPage);

        // --- Page 2: Subject Selection ---
        this._subjectsPage = document.createElement('div');
        this._subjectsPage.classList.add('globular-wizard-page', 'subjects-page-content');
        this._populateSubjectsPage(this._subjectsPage); // Setup subjects view and selected
        this._wizard.appendPage(this._subjectsPage);

        // --- Page 3: Permission Settings ---
        this._permissionsPage = document.createElement('div');
        this._permissionsPage.classList.add('globular-wizard-page');
        this._populatePermissionsPage(this._permissionsPage); // Setup shared permissions component
        this._wizard.appendPage(this._permissionsPage);

        // --- Page 4: Summary ---
        this._summaryPage = document.createElement('div');
        this._summaryPage.classList.add('globular-wizard-page', 'summary-page-content');
        this._wizard.setSummaryPage(this._summaryPage); // Set summary page

        // --- Wizard Callbacks ---
        this._wizard.ondone = this._handleWizardDone.bind(this);
        this._wizard.onclose = this._handleWizardClose.bind(this);
    }

    /**
     * Populates the files selection page with interactive file cards.
     * @param {HTMLElement} pageElement - The div element for the files page.
     * @private
     */
    _populateFilesPage(pageElement) {
        this._files.forEach(file => {
            const fileId = `_file_${getUuidByString(file.getPath())}`;
            const alias = this._getFileAlias(file); // Get display name for file

            const fileCardHtml = `
                <div class="file-card">
                    <div class="file-info-header">
                        <paper-checkbox id="${fileId}_checkbox" checked></paper-checkbox>
                        <span class="title-span">${alias}</span>
                        <iron-icon class="wizard-file-infos-btn" id="${fileId}_infos_btn" icon="icons:info"></iron-icon>
                    </div>
                    <img src="${file.getThumbnail()}" alt="File Thumbnail">
                </div>
            `;
            pageElement.appendChild(document.createRange().createContextualFragment(fileCardHtml));

            // Bind events for the created file card
            const checkbox = pageElement.querySelector(`#${fileId}_checkbox`);
            const infosBtn = pageElement.querySelector(`#${fileId}_infos_btn`);

            file.selected = true; // Default to selected
            checkbox.addEventListener('click', () => {
                file.selected = checkbox.checked; // Update file.selected state
            });

            if (infosBtn) {
                // Determine which info function to call based on file type
                const infoFunc = this._getInfoDisplayFunction(file);
                if (infoFunc) {
                    infosBtn.addEventListener('click', () => infoFunc(file));
                    infosBtn.addEventListener('mouseover', () => infosBtn.style.cursor = "pointer");
                    infosBtn.addEventListener('mouseleave', () => infosBtn.style.cursor = "default");
                } else {
                    infosBtn.style.display = "none"; // Hide info button if no handler
                }
            }
        });
    }

    /**
     * Helper to get a display alias for a file object.
     * @param {Object} file - The file object.
     * @returns {string} The display name.
     * @private
     */
    _getFileAlias(file) {
        let name = file.getName();
        if (file.titles && file.titles.length > 0) {
            const title = file.titles[0];
            name = title.getName();
            if (title.getEpisode && title.getEpisode() > 0) {
                name += ` S${title.getSeason()}-E${title.getEpisode()}`;
            }
        } else if (file.videos && file.videos.length > 0) {
            name = file.videos[0].getDescription();
        } else if (file.audios && file.audios.length > 0) {
            name = file.audios[0].getTitle();
        }
        return name;
    }

    /**
     * Helper to get the correct info display function based on file type.
     * @param {Object} file - The file object.
     * @returns {Function|null} The global info display function (e.g., showGlobalTitleInfo) or null.
     * @private
     */
    _getInfoDisplayFunction(file) {
        if (file.titles && file.titles.length > 0) return showGlobalTitleInfo;
        if (file.videos && file.videos.length > 0) return showGlobalVideoInfo;
        // if (file.audios && file.audios.length > 0) return showGlobalAudioInfo; // Assuming showGlobalAudioInfo exists
        return null;
    }


    /**
     * Populates the subjects selection page.
     * @param {HTMLElement} pageElement - The div element for the subjects page.
     * @private
     */
    _populateSubjectsPage(pageElement) {
        this._subjectsView = new GlobularSubjectsView();
        this._selectedSubjects = new GlobularSubjectsSelected();

        pageElement.appendChild(this._subjectsView);
        pageElement.appendChild(this._selectedSubjects);

        // Bind change events from subjects view to update selected subjects
        this._subjectsView.on_account_click = (accountDiv, account) => {
            this._selectedSubjects.appendAccount(accountDiv, account);
            this._sharedSubjectsPermission.setAccounts(this._selectedSubjects.getAccounts());
        };
        this._subjectsView.on_group_click = (groupDiv, group) => {
            this._selectedSubjects.appendGroup(groupDiv, group);
            this._sharedSubjectsPermission.setGroups(this._selectedSubjects.getGroups());
        };
        // Add more types (application, organization, peer) as needed
        // subjectsView.on_application_click = (appDiv, app) => { this._selectedSubjects.appendApplication(appDiv, app); this._sharedSubjectsPermission.setApplications(this._selectedSubjects.getApplications()); };
        // subjectsView.on_organization_click = (orgDiv, org) => { this._selectedSubjects.appendOrganization(orgDiv, org); this._sharedSubjectsPermission.setOrganizations(this._selectedSubjects.getOrganizations()); };
        // subjectsView.on_peer_click = (peerDiv, peer) => { this._selectedSubjects.appendPeer(peerDiv, peer); this._sharedSubjectsPermission.setPeers(this._selectedSubjects.getPeers()); };

        // Bind removal events from selected subjects view
        this._selectedSubjects.on_account_removed = () => {
            this._sharedSubjectsPermission.setAccounts(this._selectedSubjects.getAccounts());
        };
        this._selectedSubjects.on_group_removed = () => {
            this._sharedSubjectsPermission.setGroups(this._selectedSubjects.getGroups());
        };
        // Add more types (application, organization, peer) as needed
    }

    /**
     * Populates the permissions settings page.
     * @param {HTMLElement} pageElement - The div element for the permissions page.
     * @private
     */
    _populatePermissionsPage(pageElement) {
        this._sharedSubjectsPermission = new SharedSubjectsPermissions();
        pageElement.appendChild(this._sharedSubjectsPermission);

        // Pass initial subjects from the selected list
        this._sharedSubjectsPermission.setAccounts(this._selectedSubjects.getAccounts());
        this._sharedSubjectsPermission.setGroups(this._selectedSubjects.getGroups());
        // Add more types if needed
        // this._sharedSubjectsPermission.setApplications(this._selectedSubjects.getApplications());
        // this._sharedSubjectsPermission.setOrganizations(this._selectedSubjects.getOrganizations());
        // this._sharedSubjectsPermission.setPeers(this._selectedSubjects.getPeers());
    }

    /**
     * Handles the completion of the wizard (ondone callback).
     * Collects permissions and initiates saving them to backend.
     * @param {HTMLElement} summaryPageElement - The HTMLElement representing the summary page content.
     * @private
     */
    async _handleWizardDone(summaryPageElement) {
        // Collect permissions from the SharedSubjectsPermissions component
        const permissions = this._sharedSubjectsPermission.getPermissions();

        // Filter selected files
        const selectedFiles = this._files.filter(f => f.selected);

        // Display summary message
        this._displaySummary(summaryPageElement, selectedFiles, this._selectedSubjects.getAccounts(), this._selectedSubjects.getGroups()); // Pass groups too

        // Save permissions for selected files
        const errors = await this._setFilesPermissions(permissions, selectedFiles);

        // Update summary page with success/failure status
        this._updateSummaryStatus(summaryPageElement, errors, selectedFiles);

        // Send notifications
        await this._sendNotificationsToParticipants(selectedFiles, errors, this._selectedSubjects.getAccounts(), this._selectedSubjects.getGroups());
    }

    /**
     * Saves permissions for the selected files to the backend.
     * @param {Object} permissions - The permission object (allowed/denied lists) from SharedSubjectsPermissions.
     * @param {Array<Object>} files - The file objects to set permissions for.
     * @returns {Promise<Object>} A promise that resolves with a map of errors (filePath -> error object).
     * @private
     */
    async _setFilesPermissions(permissions, files) {
        const errors = {};
        const filesToProcess = files.filter(f => f.selected); // Ensure only selected files are processed

        for (const file of filesToProcess) {
            try {
                const globule = file.globule; // Assuming file object has globule reference
                if (!globule) throw new Error(`Globule not found for file ${file.getPath()}`);

                // Get existing permissions for the file
                const getRqst = new GetResourcePermissionsRqst();
                getRqst.setPath(file.getPath());
                let existingPermissions = null;
                try {
                    const token = await Backend.authenticatedCall(globule);
                    const rsp = await globule.rbacService.getResourcePermissions(getRqst, { domain: globule.domain, token: token });
                    existingPermissions = rsp.getPermissions();
                } catch (getResourceErr) {
                    // If permissions don't exist, start with a new Permissions object
                    if (getResourceErr.message && JSON.parse(getResourceErr.message).ErrorMsg.startsWith("item not found")) {
                         existingPermissions = new Permissions();
                    } else {
                        throw getResourceErr; // Re-throw other errors
                    }
                }

                // Merge new permissions from the wizard with existing ones
                const mergedPermissions = this._mergePermissions(existingPermissions, permissions);

                // Save merged permissions
                const setRqst = new SetResourcePermissionsRqst();
                setRqst.setPath(file.getPath());
                setRqst.setResourcetype("file"); // Assuming resource type is "file" for these resources
                setRqst.setPermissions(mergedPermissions);

                const token = await Backend.authenticatedCall(globule);
                await globule.rbacService.setResourcePermissions(setRqst, { domain: globule.domain, token: token });
            } catch (err) {
                console.error(`Failed to set permissions for file ${file.getPath()}:`, err);
                errors[file.getPath()] = err;
            }
        }
        return errors;
    }

    /**
     * Merges new permissions (from wizard UI) with existing permissions (from backend).
     * This handles adding new allowed/denied subjects and ensuring no conflicts.
     * @param {Object} existingPermissions - The Permissions object from the backend.
     * @param {Object} newPermissionsFromUI - The `permissions` object derived from SharedSubjectsPermissions UI state.
     * @returns {Object} A new Permissions object with merged data.
     * @private
     */
    _mergePermissions(existingPermissions, newPermissionsFromUI) {
        const merged = new Permissions();
        merged.setPath(existingPermissions.getPath()); // Keep original path
        merged.setResourceType(existingPermissions.getResourceType()); // Keep original type

        // Helper to merge subject lists (accounts, groups, etc.) for a specific permission (read, write, delete)
        const mergeSubjectLists = (existingPermList, newPermList, setter) => {
            const mergedSubjectIds = new Set();
            existingPermList.forEach(id => mergedSubjectIds.add(id));
            newPermList.forEach(id => mergedSubjectIds.add(id));
            setter(Array.from(mergedSubjectIds));
        };

        // Merge owner permission (simplistic: if new has owners, it overrides existing)
        // More complex logic might be needed for actual owner merging rules.
        if (newPermissionsFromUI.owners && newPermissionsFromUI.owners.length > 0) {
            merged.setOwners(newPermissionsFromUI.owners[0]); // Assuming only one owner permission
        } else {
            merged.setOwners(existingPermissions.getOwners());
        }

        // Merge allowed permissions
        const allowedMap = new Map(); // Map permissionName -> Permission object
        existingPermissions.getAllowedList().forEach(p => allowedMap.set(p.getName(), p));

        newPermissionsFromUI.allowed.forEach(newP => {
            const existingP = allowedMap.get(newP.getName());
            if (existingP) {
                // Merge subject lists for existing permission
                const mergedPerm = new Permission();
                mergedPerm.setName(newP.getName());
                mergeSubjectLists(existingP.getAccountsList(), newP.getAccountsList(), mergedPerm.setAccountsList);
                mergeSubjectLists(existingP.getGroupsList(), newP.getGroupsList(), mergedPerm.setGroupsList);
                // ... merge other subject types
                merged.addAllowed(mergedPerm);
            } else {
                // Add new allowed permission from UI
                merged.addAllowed(newP);
            }
        });

        // Merge denied permissions (similar logic)
        const deniedMap = new Map();
        existingPermissions.getDeniedList().forEach(p => deniedMap.set(p.getName(), p));

        newPermissionsFromUI.denied.forEach(newP => {
            const existingP = deniedMap.get(newP.getName());
            if (existingP) {
                const mergedPerm = new Permission();
                mergedPerm.setName(newP.getName());
                mergeSubjectLists(existingP.getAccountsList(), newP.getAccountsList(), mergedPerm.setAccountsList);
                mergeSubjectLists(existingP.getGroupsList(), newP.getGroupsList(), mergedPerm.setGroupsList);
                // ...
                merged.addDenied(mergedPerm);
            } else {
                merged.addDenied(newP);
            }
        });

        return merged;
    }

    /**
     * Displays summary information on the wizard's summary page.
     * @param {HTMLElement} summaryPageElement - The summary page HTML element.
     * @param {Array<Object>} selectedFiles - The files that were selected for sharing.
     * @param {Array<Object>} participants - The Account objects of participants.
     * @param {Array<Object>} groups - The Group objects of participants.
     * @private
     */
    _displaySummary(summaryPageElement, selectedFiles, participants, groups) {
        // Clear previous summary content
        summaryPageElement.innerHTML = `
            <style>
                .summary-page-content {
                    display: flex; height: 100%;
                }
                .summary-status-icon-wrapper {
                    flex-shrink: 0;
                    margin-right: 20px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .summary-status-icon {
                    height: 64px; width: 64px;
                }
                .summary-text-content {
                    display: flex; flex-direction: column; flex-grow: 1;
                    padding-left: 30px; border-left: 1px solid var(--palette-divider);
                }
                .summary-text-content p { margin: 5px 0; font-size: 1rem; color: var(--primary-text-color); }
                .summary-list-container { padding: 10px 0; }
                .summary-list {
                    display: flex; flex-wrap: wrap; gap: 10px;
                    padding: 0; margin: 0; list-style: none;
                }
                .summary-list .infos { /* Reusing infos style from sharedSubjectsPermissions */
                    margin: 2px; padding: 4px; display: flex; flex-direction: column;
                    border-radius: 4px; align-items: center; background-color: var(--surface-color);
                    color: var(--primary-text-color); box-shadow: var(--shadow-elevation-2dp);
                }
                .summary-list .infos img { max-height: 64px; max-width: 64px; border-radius: 32px; object-fit: cover;}
                .summary-list .infos iron-icon { width: 32px; height: 32px; }
                .summary-list .infos span { font-size: 0.9rem; text-align: center; }
            </style>
            <div class="summary-page-content">
                <div class="summary-status-icon-wrapper">
                    <iron-icon id="status-ico" class="summary-status-icon" icon="icons:check-circle" style="fill: var(--palette-success-main);"></iron-icon>
                </div>
                <div class="summary-text-content">
                    <p id="summary-main-message"></p>
                    <div class="summary-list-container">
                        <p>Shared Resources:</p>
                        <div id="resources-list" class="summary-list"></div>
                    </div>
                    <div class="summary-list-container">
                        <p>Participants Notified:</p>
                        <div id="participants-list" class="summary-list"></div>
                    </div>
                </div>
            </div>
        `;

        const statusIco = summaryPageElement.querySelector("#status-ico");
        const mainMessageP = summaryPageElement.querySelector("#summary-main-message");
        const resourcesDiv = summaryPageElement.querySelector("#resources-list");
        const participantsDiv = summaryPageElement.querySelector("#participants-list");

        mainMessageP.textContent = `Resources permissions were successfully processed.`;

        // Display files list
        selectedFiles.forEach(file => {
            const alias = this._getFileAlias(file);
            const fileDiv = document.createElement('div');
            fileDiv.classList.add('infos');
            fileDiv.innerHTML = `
                <img src="${file.getThumbnail()}" alt="File Thumbnail">
                <span>${alias}</span>
            `;
            resourcesDiv.appendChild(fileDiv);
        });

        // Collect all unique participants from accounts and groups
        let allParticipants = [...participants];
        groups.forEach(group => {
            // This requires fetching group members. If GroupController.getMembers is async, do it here.
            // For now, I'll assume groups are just displayed as group names, or members are pre-fetched.
            // If members need to be fetched:
            // GroupController.getMembers(group.getId(), members => { allParticipants.push(...members); displayParticipants(); });
            // For now, just display the group itself as a participant.
            allParticipants.push(group);
        });
        // Deduplicate participants by ID
        allParticipants = [...new Map(allParticipants.map(p => [p.getId ? p.getId() : p.id, p])).values()];


        // Display participants list
        allParticipants.forEach(p => {
            let name = p.getName ? p.getName() : p.id;
            if (p.getFirstname && p.getLastname && p.getFirstname() && p.getLastname()) {
                name = `${p.getFirstname()} ${p.getLastname()}`;
            }

            const participantDiv = document.createElement('div');
            participantDiv.classList.add('infos');
            participantDiv.innerHTML = `
                ${p.getProfilepicture && p.getProfilepicture() ? `<img src="${p.getProfilepicture()}" alt="Profile Picture">` : `<iron-icon icon="${p instanceof Group ? 'social:people' : 'account-circle'}"></iron-icon>`}
                <span>${name}</span>
            `;
            participantsDiv.appendChild(participantDiv);
        });
    }

    /**
     * Updates the summary page's status icon and message based on errors.
     * @param {HTMLElement} summaryPageElement - The summary page HTMLElement.
     * @param {Object} errors - Map of file paths to error objects.
     * @param {Array<Object>} selectedFiles - The files that were selected.
     * @private
     */
    _updateSummaryStatus(summaryPageElement, errors, selectedFiles) {
        const statusIco = summaryPageElement.querySelector("#status-ico");
        const mainMessageP = summaryPageElement.querySelector("#summary-main-message");
        const nbTotal = selectedFiles.length;
        const nbFail = Object.keys(errors).length;

        if (nbFail === 0) {
            statusIco.icon = "icons:check-circle";
            statusIco.style.fill = "var(--palette-success-main)";
            mainMessageP.textContent = `Resources permissions were successfully created for all ${nbTotal} selected files.`;
        } else if (nbFail === nbTotal) {
            statusIco.icon = "icons:error";
            statusIco.style.fill = "var(--palette-error-main)";
            mainMessageP.textContent = `Failed to set permissions for all ${nbTotal} selected files.`;
        } else {
            statusIco.icon = "icons:warning";
            statusIco.style.fill = "var(--palette-warning-main)";
            mainMessageP.textContent = `Permissions set for ${nbTotal - nbFail} of ${nbTotal} files. ${nbFail} failed.`;
        }
    }

    /**
     * Sends notifications to participants about shared resources.
     * @param {Array<Object>} selectedFiles - The files that were successfully shared.
     * @param {Object} errors - Map of errors for files that failed to share.
     * @param {Array<Object>} accounts - The Account objects selected.
     * @param {Array<Object>} groups - The Group objects selected.
     * @private
     */
    async _sendNotificationsToParticipants(selectedFiles, errors, accounts, groups) {
        // Collect all unique individual Account objects that will receive notifications
        let allParticipants = [...accounts];

        for (const group of groups) {
            try {
                // Assuming GroupController.getMembers is promisified
                const groupMembers = await GroupController.getMembers(group.getId());
                groupMembers.forEach(member => {
                    // Add only if not already in the list
                    if (!allParticipants.some(p => p.getId() === member.getId())) {
                        allParticipants.push(member);
                    }
                });
            } catch (err) {
                console.error(`Failed to get members for group ${group.getId()}: ${err.message}`);
                displayError(`Failed to notify members of group ${group.getName()}.`, 3000);
            }
        }

        // Filter out participants who are the sender themselves
        const senderId = AccountController.account.getId();
        const finalParticipants = allParticipants.filter(p => p.getId() !== senderId);

        // Send notification for each successfully shared file to each participant
        const notificationPromises = [];
        const successfullySharedFiles = selectedFiles.filter(f => !errors[f.getPath()]);

        for (const file of successfullySharedFiles) {
            for (const contact of finalParticipants) {
                try {
                    const globule = Backend.getGlobule(contact.getDomain()); // Get globule for recipient's domain
                    if (!globule) {
                        console.warn(`No globule for domain ${contact.getDomain()}. Cannot send notification to ${contact.getEmail()}.`);
                        continue;
                    }
                    const token = await Backend.authenticatedCall(globule); // Authenticate

                    const notification = new Notification();
                    notification.setDate(Math.floor(Date.now() / 1000));
                    notification.setId(randomUUID());
                    notification.setRecipient(`${contact.getId()}@${contact.getDomain()}`);
                    notification.setSender(`${AccountController.account.getId()}@${AccountController.account.getDomain()}`);
                    notification.setNotificationType(NotificationType.USER_NOTIFICATION);
                    notification.setMac(globule.config.Mac); // MAC from recipient's globule

                    const alias = this._getFileAlias(file); // Get display alias
                    const date = new Date(); // Current date for message

                    const messageHtml = `
                        <div style="display: flex; flex-direction: column; padding: 16px;">
                            <div>${date.toLocaleString()}</div>
                            <div>
                                <p>${AccountController.account.getName()} has shared a file with you:</p>
                                <globular-link alias="${alias}" mime="${file.getMime()}" path="${file.getPath()}" thumbnail="${file.getThumbnail()}" domain="${file.globule.domain}"></globular-link>
                            </div>
                        </div>
                    `;
                    notification.setMessage(messageHtml);

                    const rqst = new CreateNotificationRqst();
                    rqst.setNotification(notification);

                    notificationPromises.push(
                        globule.resourceService.createNotification(rqst, {
                            token: token,
                            domain: contact.getDomain()
                        }).then(() => {
                            Backend.getGlobule(contact.getDomain()).eventHub.publish(`${contact.getId()}@${contact.getDomain()}_notification_event`, notification.serializeBinary(), false);
                        })
                    );
                } catch (notificationErr) {
                    console.error(`Failed to send notification for ${file.getPath()} to ${contact.getEmail()}: ${notificationErr.message}`);
                    displayError(`Failed to send notification for "${file.getName()}" to some recipients.`, 3000);
                }
            }
        }
        await Promise.allSettled(notificationPromises); // Wait for all notifications to attempt sending
    }
}
customElements.define('globular-share-resource-wizard', ShareResourceWizard);