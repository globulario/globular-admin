// src/components/blog/blog_post_info.js

import { Backend } from "../../backend/backend";
import { displayError} from "../../backend/ui/notify";
import { getBlogPostsByUUIDs } from "../../backend/media/blog"; // <-- new backend accessor
import { listToString } from "../utility";

/**
 * Displays basic blog post information in either a short card view or a detailed view.
 */
export class BlogPostInfo extends HTMLElement {
  // Internal state
  _blogPost = null;      // blogpb.BlogPost
  _globule = null;       // Globule instance for the post domain
  _isShortMode = false;  // short card vs full details
  _listeners = {};       // eventHub subscriptions (ids) to clean up

  static get observedAttributes() { return ["short"]; }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this._render();
    this._setupBackendSubscriptions();
  }

  disconnectedCallback() {
    for (const id in this._listeners) {
      try { Backend.eventHub.unsubscribe(this._listeners[id]); } catch {}
    }
    this._listeners = {};
  }

  attributeChangedCallback(name, _oldValue, newValue) {
    if (name === "short") {
      // treat presence or "true" as true
      const next = newValue === "" || newValue === "true";
      if (this._isShortMode !== next) {
        this._isShortMode = next;
        this._render();
      }
    }
  }

  set blogPost(post) {
    if (this._blogPost === post) return;
    this._blogPost = post;
    this._globule = post?.globule || Backend.getGlobule(post?.getDomain?.());
    this._render();
    this._setupBackendSubscriptions();
  }
  get blogPost() { return this._blogPost; }

  set globule(g) {
    if (this._globule === g) return;
    this._globule = g;
    this._render();
  }
  get globule() { return this._globule; }

  /* ------------------------------- rendering ------------------------------- */

  _render() {
    if (!this._blogPost) {
      this.shadowRoot.innerHTML = `
        <style>#container{color:var(--primary-text-color);padding:10px;}</style>
        <div id="container"><p>No blog post data available.</p></div>`;
      return;
    }

    const title = this._blogPost.getTitle?.() ?? "";
    const subtitle = this._blogPost.getSubtitle?.() ?? "";
    const author = this._blogPost.getAuthor?.() ?? "";
    const language = this._blogPost.getLanguage?.() ?? "";
    const keywords = this._blogPost.getKeywordsList?.() ?? [];
    const creationSec = this._blogPost.getCreationtime?.() ?? 0;
    const creationTime = new Date((creationSec || 0) * 1000);
    const thumbnail = this._blogPost.getThumbnail?.() ?? "";
    const statusVal = this._blogPost.getStatus?.();
    const statusText = statusVal === 1 ? "Published" : statusVal === 2 ? "Archived" : "Draft";

    if (this._isShortMode) {
      this.shadowRoot.innerHTML = `
        <style>
          #container { color: var(--primary-text-color); user-select: none; }
          .blog-post-card {
            display: flex; flex-direction: column;
            border-radius: 8px; border: 1px solid var(--palette-divider);
            width: 320px; margin: 10px; height: 285px; overflow: hidden;
            background: var(--surface-color);
            transition: box-shadow .2s ease, transform .2s ease;
          }
          .blog-post-card:hover { box-shadow: var(--shadow-elevation-6dp); transform: translateY(-2px); cursor: pointer; }
          .image-box { position: relative; width: 100%; height: 50%; overflow: hidden; background: #0002; }
          .image-box img { width: 100%; height: 100%; object-fit: cover; transition: transform .2s ease; display:${thumbnail ? "block" : "none"}; }
          .blog-post-card:hover .image-box img { transform: scale(1.05); }
          .text-content { display: flex; flex-direction: column; padding: 10px; flex: 1; justify-content: space-between; }
          .blog-title { font-weight: 700; font-size: 18px; line-height: 1.3; margin-bottom: 6px;
                        overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
          .blog-subtitle { font-size: 14px; color: var(--secondary-text-color); margin-bottom: 10px;
                           overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
          .blog-meta { display: flex; justify-content: space-between; font-size: 12px; color: var(--secondary-text-color); }
          .blog-author { font-weight: 600; }
        </style>
        <div id="container" class="blog-post-card">
          <div class="image-box">
            <img id="thumbnail_img" src="${thumbnail}">
          </div>
          <div class="text-content">
            <div class="main-info">
              <div id="title_div" class="blog-title">${title}</div>
              <div id="sub_title_div" class="blog-subtitle">${subtitle}</div>
            </div>
            <div class="blog-meta">
              <div id="author_div" class="blog-author">${author}</div>
              <div id="creation_time_div">${creationTime.toLocaleDateString()}</div>
            </div>
          </div>
        </div>
      `;
    } else {
      this.shadowRoot.innerHTML = `
        <style>
          #container { color: var(--primary-text-color); user-select: none; }
          .detail-view-container { display: flex; padding: 20px; gap: 20px; align-items: flex-start; flex-wrap: wrap; }
          .thumbnail-column { flex-shrink: 0; width: 128px; }
          .thumbnail-column img { width: 100%; height: auto; object-fit: cover; border-radius: 8px; border: 1px solid var(--palette-divider); display:${thumbnail ? "block" : "none"}; }
          .info-table { display: table; flex: 1; border-collapse: separate; border-spacing: 0 8px; min-width: 260px; }
          .info-row { display: table-row; }
          .info-label { display: table-cell; font-weight: 600; padding-right: 15px; white-space: nowrap; vertical-align: top; }
          .info-value { display: table-cell; line-height: 1.4; word-break: break-word; }
        </style>
        <div id="container" class="detail-view-container">
          <div class="thumbnail-column">
            <img id="thumbnail_img" src="${thumbnail}" alt="Blog Thumbnail">
          </div>
          <div class="info-table">
            <div class="info-row">
              <div class="info-label">Id:</div>
              <div class="info-value" id="uuid_div">${this._blogPost.getUuid?.() ?? ""}</div>
            </div>
            <div class="info-row">
              <div class="info-label">Title:</div>
              <div class="info-value" id="title_div">${title}</div>
            </div>
            <div class="info-row">
              <div class="info-label">Subtitle:</div>
              <div class="info-value" id="sub_title_div">${subtitle}</div>
            </div>
            <div class="info-row">
              <div class="info-label">Author:</div>
              <div class="info-value" id="author_div">${author}</div>
            </div>
            <div class="info-row">
              <div class="info-label">Status:</div>
              <div class="info-value" id="status_div">${statusText}</div>
            </div>
            <div class="info-row">
              <div class="info-label">Language:</div>
              <div class="info-value" id="language_div">${language}</div>
            </div>
            <div class="info-row">
              <div class="info-label">Date:</div>
              <div class="info-value" id="creation_time_div">${creationTime.toLocaleDateString()}</div>
            </div>
            <div class="info-row">
              <div class="info-label">Keywords:</div>
              <div class="info-value" id="keywords_div">${listToString(keywords)}</div>
            </div>
          </div>
        </div>
      `;
    }

    this._getDomReferences();
    this._bindDomEvents();
  }

  _getDomReferences() {
    this._container = this.shadowRoot.querySelector("#container");
    this._thumbnailImg = this.shadowRoot.querySelector("#thumbnail_img");
    this._titleDiv = this.shadowRoot.querySelector("#title_div");
    this._subTitleDiv = this.shadowRoot.querySelector("#sub_title_div");
    this._authorDiv = this.shadowRoot.querySelector("#author_div");
    this._creationTimeDiv = this.shadowRoot.querySelector("#creation_time_div");
    this._statusDiv = this.shadowRoot.querySelector("#status_div");
    this._languageDiv = this.shadowRoot.querySelector("#language_div");
    this._keywordsDiv = this.shadowRoot.querySelector("#keywords_div");
  }

  _bindDomEvents() {
    // optional: emit a custom event when card is clicked (useful in grids)
    if (this._isShortMode && this._container) {
      this._container.onclick = () => {
        this.dispatchEvent(new CustomEvent("blog-post-selected", {
          bubbles: true, composed: true,
          detail: { uuid: this._blogPost?.getUuid?.(), domain: this._blogPost?.getDomain?.() }
        }));
      };
    }
  }

  /* ------------------------------ live updates ------------------------------ */

  _setupBackendSubscriptions() {
    if (!this._blogPost || !this._globule) return;

    // clear old subs
    for (const k in this._listeners) {
      try { Backend.eventHub.unsubscribe(this._listeners[k]); } catch {}
    }
    this._listeners = {};

    const uuid = this._blogPost.getUuid?.();
    if (!uuid) return;

    // update event
    Backend.eventHub.subscribe(
      `${uuid}_blog_updated_event`,
      (id) => { this._listeners.update = id; },
      async (_evt) => {
        try {
          // Refresh this post via controller (streaming → capture first emission)
          let refreshed = null;
          await getBlogPostsByUUIDs([uuid], (post) => { if (!refreshed) refreshed = post; });
          if (refreshed) {
            this._blogPost = refreshed;
            this._updateFields();
          }
        } catch (err) {
          displayError(`Failed to refresh blog post: ${err?.message || err}`, 4000);
        }
      },
      false,
      this
    );

    // delete event
    Backend.eventHub.subscribe(
      `${uuid}_blog_delete_event`,
      (id) => { this._listeners.delete = id; },
      (_evt) => {
        if (this.parentNode) this.parentNode.removeChild(this);
      },
      false,
      this
    );
  }

  _updateFields() {
    if (!this._blogPost) return;

    const title = this._blogPost.getTitle?.() ?? "";
    const subtitle = this._blogPost.getSubtitle?.() ?? "";
    const author = this._blogPost.getAuthor?.() ?? "";
    const creationSec = this._blogPost.getCreationtime?.() ?? 0;
    const creationTime = new Date((creationSec || 0) * 1000);
    const thumbnail = this._blogPost.getThumbnail?.() ?? "";
    const statusVal = this._blogPost.getStatus?.();
    const statusText = statusVal === 1 ? "Published" : statusVal === 2 ? "Archived" : "Draft";
    const language = this._blogPost.getLanguage?.() ?? "";
    const keywords = this._blogPost.getKeywordsList?.() ?? [];

    if (this._thumbnailImg) {
      this._thumbnailImg.src = thumbnail;
      this._thumbnailImg.style.display = thumbnail ? "block" : "none";
    }
    if (this._titleDiv) this._titleDiv.textContent = title;
    if (this._subTitleDiv) this._subTitleDiv.textContent = subtitle;
    if (this._authorDiv) this._authorDiv.textContent = author;
    if (this._creationTimeDiv) this._creationTimeDiv.textContent = creationTime.toLocaleDateString();
    if (this._statusDiv) this._statusDiv.textContent = statusText;
    if (this._languageDiv) this._languageDiv.textContent = language;
    if (this._keywordsDiv) this._keywordsDiv.textContent = listToString(keywords);
  }
}

customElements.define("globular-blog-post-info", BlogPostInfo);
