import { GetSharedResourceRqst, RemoveSubjectFromShareRqst, SubjectType } from "globular-web-client/rbac/rbac_pb"; // Assuming protos are here
import { AccountController } from "../../backend/account"; // For AccountController.account
import { Backend, displayError, displayMessage } from "../../backend/backend"; // Use Backend.authenticatedCall
import getUuidByString from "uuid-by-string";
// Assuming these are actual classes from resource_pb.js
import { Account, Group } from "globular-web-client/resource/resource_pb";
// Assuming Application and Organization protos might be used implicitly in _getDeleteableStatus
// For robust type checking, these would need to be imported or handled with string checks.
// import { Application } from "globular-web-client/resource/resource_pb"; // Example if Application is a proto
// import { Organization } from "globular-web-client/resource/resource_pb"; // Example if Organization is a proto

import { FileController } from "../../backend/file"; // Assuming FileController is promisified
import { Link } from "../link"; // Assuming Link is a custom element (globular-link)
import '@polymer/paper-tabs/paper-tabs.js'; // Needed for paper-tabs
import '@polymer/paper-tabs/paper-tab.js'; // Needed for paper-tab
import '@polymer/paper-ripple/paper-ripple.js'; // Needed for paper-ripple
import '@polymer/paper-badge/paper-badge.js'; // If paper-badge is desired (mentioned in comments)

/**
 * Promisified wrapper for FileController.getFile.
 * @param {Object} globule - The globule instance.
 * @param {string} path - The file path.
 * @param {number} width - Desired thumbnail width.
 * @param {number} height - Desired thumbnail height.
 * @returns {Promise<any>} A promise that resolves with the file object.
 */
async function promisifiedGetFile(globule, path, width, height) {
    return new Promise((resolve, reject) => {
        FileController.getFile(globule, path, width, height, resolve, reject);
    });
}

/**
 * Custom element that displays resources shared with/by a specific subject.
 * Categorizes resources into "Shared with you" and "You share with" lists.
 */
export class SharedResources extends HTMLElement {
    // Private instance properties
    _fileExplorer = null; // Reference to the parent file explorer
    _subject = null; // The subject (Account, Group, etc.) for whom resources are displayed

    // DOM element references
    _scrollContainer = null;
    _shareWithYouDiv = null;
    _youShareWithDiv = null;
    _shareWithYouTab = null;
    _youShareWithTab = null;

    /**
     * Constructor for the SharedResources custom element.
     * Initializes the shadow DOM.
     */
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        // DOM rendering and event binding in connectedCallback
    }

    /**
     * Called when the element is inserted into the document's DOM.
     * Performs initial rendering, gets DOM references, and binds event listeners.
     */
    connectedCallback() {
        this._renderInitialStructure();
        this._getDomReferences();
        this._bindEventListeners();

        // Data fetching is triggered by the subject setter
    }

    /**
     * Sets the file explorer instance.
     * @param {Object} explorer - The file explorer object.
     */
    setFileExplorer(explorer) {
        this._fileExplorer = explorer;
    }

    /**
     * Sets the subject for whom shared resources are displayed.
     * Triggers fetching and displaying resources.
     * @param {Object} subject - The subject object (Account, Group, etc.).
     */
    set subject(subject) {
        if (this._subject !== subject) {
            this._subject = subject;
            this._loadAndDisplaySharedResources(); // Load data for new subject
        }
    }

    /**
     * Renders the initial HTML structure of the shared resources panel.
     * @private
     */
    _renderInitialStructure() {
        this.shadowRoot.innerHTML = `
            <style>
                ::-webkit-scrollbar { width: 5px; height: 5px; }
                ::-webkit-scrollbar-track { background: var(--surface-color); }
                ::-webkit-scrollbar-thumb { background: var(--palette-divider); }

                #container {
                    display: flex;
                    flex-direction: column;
                    height: 100%;
                    width: 100%; /* Take full width of parent */
                    box-sizing: border-box; /* Include padding/border in width */
                }

                .resource-share-panel {
                    flex-grow: 1; /* Takes remaining height */
                    position: relative; /* For absolute positioning of scroll container */
                    overflow: hidden; /* Hide overflow from scroll container */
                    display: flex; /* For inner content layout */
                    flex-direction: column;
                }

                #scroll-container {
                    position: absolute;
                    overflow-y: auto;
                    top: 0px; left: 0px; right: 0px; bottom: 0px;
                    padding: 10px; /* Padding for content */
                }

                #share-with-you-list, #you-share-with-list {
                    display: flex;
                    flex-wrap: wrap; /* Allow resources to wrap */
                    margin-top: 10px; /* Space from tabs or previous content */
                    gap: 15px; /* Space between resource links/cards */
                    justify-content: flex-start; /* Align items to start */
                }
                #you-share-with-list { display: none; } /* Hidden by default */

                globular-link {
                    margin-left: 15px; /* Original margin, might be replaced by gap */
                }

                paper-tabs {
                    --paper-tabs-selection-bar-color: var(--primary-color);
                    color: var(--primary-text-color);
                    --paper-tab-ink: var(--palette-action-disabled);
                    width: 100%;
                    background-color: var(--surface-color); /* Ensure background for tabs */
                    border-bottom: 1px solid var(--palette-divider); /* Separator below tabs */
                    flex-shrink: 0; /* Prevent tabs from shrinking */
                }

                paper-tab { padding-right: 25px; } /* Space for potential badge */
                paper-tab paper-badge {
                    --paper-badge-background: var(--palette-warning-main);
                    --paper-badge-width: 16px;
                    --paper-badge-height: 16px;
                    --paper-badge-margin-left: 10px;
                }

                @media(max-width: 500px){
                    #container { width: calc(100vw - 10px); margin: 0px; }
                    .resource-share-panel { width: calc(100vw - 10px); }
                    #scroll-container { padding: 5px; } /* Adjust padding for mobile */
                    #share-with-you-list, #you-share-with-list { justify-content: center; } /* Center items on mobile */
                }
            </style>
            <div id="container">
                <paper-tabs selected="0">
                    <paper-tab id="tab-share-with-you">
                        Share with you
                    </paper-tab>
                    <paper-tab id="tab-you-share-with">
                        You share with
                    </paper-tab>
                </paper-tabs>

                <div class="resource-share-panel">
                    <div id="scroll-container">
                        <div id="share-with-you-list"></div>
                        <div id="you-share-with-list"></div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Retrieves references to all necessary DOM elements.
     * @private
     */
    _getDomReferences() {
        this._scrollContainer = this.shadowRoot.querySelector("#scroll-container");
        this._shareWithYouDiv = this.shadowRoot.querySelector("#share-with-you-list");
        this._youShareWithDiv = this.shadowRoot.querySelector("#you-share-with-list");
        this._shareWithYouTab = this.shadowRoot.querySelector("#tab-share-with-you");
        this._youShareWithTab = this.shadowRoot.querySelector("#tab-you-share-with");
    }

    /**
     * Binds event listeners to interactive elements.
     * @private
     */
    _bindEventListeners() {
        if (this._scrollContainer) {
            this._scrollContainer.addEventListener('scroll', this._handleScroll.bind(this));
        }
        if (this._shareWithYouTab) {
            this._shareWithYouTab.addEventListener('click', this._handleTabClick.bind(this, 'shareWithYou'));
        }
        if (this._youShareWithTab) {
            this._youShareWithTab.addEventListener('click', this._handleTabClick.bind(this, 'youShareWith'));
        }
    }

    /**
     * Handles the scroll event on the scroll container.
     * @private
     */
    _handleScroll() {
        if (this._scrollContainer) {
            if (this._scrollContainer.scrollTop === 0) {
                this._scrollContainer.style.boxShadow = "";
                this._scrollContainer.style.borderTop = "";
            } else {
                this._scrollContainer.style.boxShadow = "inset 0px 5px 6px -3px rgba(0, 0, 0, 0.40)";
                this._scrollContainer.style.borderTop = "1px solid var(--palette-divider)";
            }
        }
    }

    /**
     * Handles clicks on the tabs to switch between "Share with you" and "You share with" lists.
     * @param {string} type - 'shareWithYou' or 'youShareWith'.
     * @private
     */
    _handleTabClick(type) {
        if (type === 'shareWithYou') {
            this._youShareWithDiv.style.display = "none";
            this._shareWithYouDiv.style.display = "flex";
        } else if (type === 'youShareWith') {
            this._youShareWithDiv.style.display = "flex";
            this._shareWithYouDiv.style.display = "none";
        }
    }

    /**
     * Loads and displays shared resources.
     * @private
     */
    async _loadAndDisplaySharedResources() {
        if (!this._subject) {
            console.warn("SharedResources: Subject not set.");
            return;
        }

        this._clearLists(); // Clear previous content

        // Load resources "You share with" (owned by the logged-in user, shared with _subject)
        const youShareWithResources = await this._getSharedResources(
            AccountController.account, // Assumes logged-in user is the owner
            this._subject // The subject this panel is about (e.g., a specific Group)
        );
        this._displaySharedResources(this._youShareWithDiv, youShareWithResources, this._subject, true); // Deleteable

        // Load resources "Shared with you" (owned by _subject, shared with logged-in user)
        const sharedWithYouResources = await this._getSharedResources(
            this._subject, // The subject this panel is about (now the owner)
            AccountController.account // The logged-in user is the recipient
        );
        this._displaySharedResources(this._shareWithYouDiv, sharedWithYouResources, AccountController.account, false); // Not deleteable by current user
    }

    /**
     * Clears the content of both resource lists.
     * @private
     */
    _clearLists() {
        this._youShareWithDiv.innerHTML = "";
        this._shareWithYouDiv.innerHTML = "";
    }

    /**
     * Displays a list of shared resources in the specified container.
     * @param {HTMLElement} containerDiv - The div to append the resource links to.
     * @param {Array<Object>} resources - An array of shared resource objects.
     * @param {Object} subjectContext - The subject context for determining deleteability.
     * @param {boolean} isDeletableByYou - True if the current user (owner) can delete this share.
     * @private
     */
    _displaySharedResources(containerDiv, resources, subjectContext, isDeletableByYou) {
        if (!resources || resources.length === 0) {
            containerDiv.innerHTML = '<p style="padding: 10px; color: var(--secondary-text-color);">No shared resources found.</p>';
            return;
        }
        containerDiv.innerHTML = ''; // Clear placeholder if resources exist

        resources.forEach(r => {
            const globule = Backend.getGlobule(r.getDomain());
            if (!globule) {
                console.warn(`Globule not found for domain ${r.getDomain()}. Cannot display resource ${r.getPath()}.`);
                return;
            }

            // Fetch the actual file details (e.g., thumbnail, mime, alias)
            promisifiedGetFile(globule, r.getPath(), 100, 64) // Get file with preview size
                .then(file => {
                    const id = `_link_${getUuidByString(file.getPath())}`;

                    // Determine if the unlink button should be displayed for this specific item
                    let showDeleteButton = false;
                    if (isDeletableByYou) { // Only if "You share with" tab and current user is owner
                        if (subjectContext instanceof Account) {
                            showDeleteButton = r.getAccountsList().includes(`${subjectContext.getId()}@${subjectContext.getDomain()}`);
                        } else if (subjectContext instanceof Group) {
                            showDeleteButton = r.getGroupsList().includes(`${subjectContext.getId()}@${subjectContext.getDomain()}`);
                        }
                        // Add more types (Application, Organization) as needed
                        // else if (subjectContext instanceof Application) { showDeleteButton = r.getApplicationsList().includes(...) }
                        // else if (subjectContext instanceof Organization) { showDeleteButton = r.getOrganizationsList().includes(...) }
                    }

                    // Determine alias/display name
                    let alias = file.getPath().substring(file.getPath().lastIndexOf("/") + 1); // Default to filename
                    if (file.videos && file.videos.length > 0) {
                        alias = file.videos[0].getDescription();
                    } else if (file.titles && file.titles.length > 0) {
                        alias = file.titles[0].getName();
                    } else if (file.audios && file.audios.length > 0) {
                        alias = file.audios[0].getTitle();
                    }

                    const linkElement = document.createElement('globular-link');
                    linkElement.alias = alias;
                    linkElement.mime = file.getMime();
                    linkElement.id = id;
                    linkElement.path = file.getPath();
                    linkElement.thumbnail = file.getThumbnail();
                    linkElement.domain = globule.domain;
                    linkElement.deleteable = showDeleteButton; // Pass deleteable status to link component
                    linkElement.setFileExplorer(this._fileExplorer); // Pass explorer reference for navigation

                    // Set up delete callback for the link
                    linkElement.ondelete = async () => {
                        await this._removeSubjectFromShare(globule, file.getPath(), subjectContext);
                        // After successful removal, refresh the current list
                        this._loadAndDisplaySharedResources();
                    };
                    containerDiv.appendChild(linkElement);

                })
                .catch(err => {
                    console.error(`Error fetching file details for ${r.getPath()}:`, err);
                    // Optionally display a broken link or message
                    const brokenLinkDiv = document.createElement('div');
                    brokenLinkDiv.innerHTML = `<span style="color: var(--palette-error-main);">[Broken Link] ${r.getPath().substring(r.getPath().lastIndexOf("/") + 1)}</span>`;
                    containerDiv.appendChild(brokenLinkDiv);
                });
        });
    }

    /**
     * Removes a subject's share for a specific resource.
     * @param {Object} globule - The globule instance.
     * @param {string} resourcePath - The path of the resource.
     * @param {Object} subjectToRemove - The subject (Account/Group/etc.) to remove from share.
     * @private
     */
    async _removeSubjectFromShare(globule, resourcePath, subjectToRemove) {
        try {
            const rqst = new RemoveSubjectFromShareRqst();
            rqst.setDomain(globule.domain);
            rqst.setPath(resourcePath);

            let subjectType;
            let subjectId;

            // Determine subject type and ID based on instance type
            if (subjectToRemove instanceof Account) {
                subjectType = SubjectType.ACCOUNT;
                subjectId = `${subjectToRemove.getId()}@${subjectToRemove.getDomain()}`;
            } else if (subjectToRemove instanceof Group) {
                subjectType = SubjectType.GROUP;
                subjectId = `${subjectToRemove.getId()}@${subjectToRemove.getDomain()}`;
            }
            // Add more types (Application, Organization) as needed for proper deletion
            // else if (subjectToRemove instanceof Application) { subjectType = SubjectType.APPLICATION; subjectId = ... }
            // else if (subjectToRemove instanceof Organization) { subjectType = SubjectType.ORGANIZATION; subjectId = ... }
            else {
                throw new Error("Unsupported subject type for unsharing.");
            }

            rqst.setType(subjectType);
            rqst.setSubject(subjectId);

            const token = await Backend.authenticatedCall(globule); // Authenticate call
            await globule.rbacService.removeSubjectFromShare(rqst, { domain: globule.domain, token: token });

            displayMessage(`"${subjectToRemove.getId()}" was unshared from "${resourcePath.substring(resourcePath.lastIndexOf('/') + 1)}"!`, 3000);
        } catch (err) {
            displayError(`Failed to unshare resource: ${err.message}`, 3000);
            console.error(err);
        }
    }


    /**
     * Retrieves a list of shared resources.
     * @param {Object} shareBy - The owner of the shared resources (Account/Group/etc.).
     * @param {Object} shareWith - The recipient of the shared resources (Account/Group/etc.).
     * @returns {Promise<Array<Object>>} A promise that resolves with an array of shared resource objects.
     * @private
     */
    async _getSharedResources(shareBy, shareWith) {
        if (!shareBy || !shareWith || !shareBy.getId || !shareBy.getDomain || !shareWith.getId || !shareWith.getDomain) {
            console.warn("Invalid shareBy or shareWith objects provided to _getSharedResources.");
            return [];
        }

        const globules = Backend.getGlobules();
        let allSharedResources = [];

        // Use Promise.allSettled to fetch resources from all globules concurrently
        const fetchPromises = globules.map(async (globule) => {
            const rqst = new GetSharedResourceRqst();
            rqst.setOwner(`${shareBy.getId()}@${shareBy.getDomain()}`);
            rqst.setSubject(`${shareWith.getId()}@${shareWith.getDomain()}`);

            let subjectType;
            if (shareWith instanceof Account) {
                subjectType = SubjectType.ACCOUNT;
            } else if (shareWith instanceof Group) {
                subjectType = SubjectType.GROUP;
            } else {
                throw new Error("Unsupported shareWith subject type.");
            }
            rqst.setType(subjectType);

            try {
                // If authentication is required for this specific call, add token here.
                // const token = await Backend.authenticatedCall(globule);
                const rsp = await globule.rbacService.getSharedResource(rqst, { domain: globule.domain /*, token: token */ });
                return rsp.getSharedresourceList();
            } catch (err) {
                console.error(`Error fetching shared resources from domain ${globule.domain}: ${err.message}`);
                displayError(`Failed to load shared resources from ${globule.domain}.`, 3000);
                return []; // Return empty array for failed globule
            }
        });

        const results = await Promise.allSettled(fetchPromises);

        results.forEach(result => {
            if (result.status === 'fulfilled' && Array.isArray(result.value)) {
                allSharedResources.push(...result.value);
            }
        });

        // Deduplicate resources if necessary (e.g., same resource shared by multiple owners in multiple globules)
        // This is a simple deduplication by path, assuming path is globally unique
        const uniqueResources = new Map();
        allSharedResources.forEach(res => {
            if (res.getPath) {
                uniqueResources.set(res.getPath(), res);
            }
        });

        return Array.from(uniqueResources.values());
    }
}

customElements.define('globular-shared-resources', SharedResources);