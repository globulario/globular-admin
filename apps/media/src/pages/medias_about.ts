class PageMediaAbout extends HTMLElement {
  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <style>
        .about-wrap {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 3rem 1.5rem;
          gap: 2rem;
          max-width: 640px;
          margin: 0 auto;
        }

        .about-card {
          width: 100%;
          background: var(--surface-elevated-color, var(--surface-color));
          border: 1px solid var(--border-subtle-color);
          border-radius: 16px;
          box-shadow: 0 6px 24px color-mix(in srgb, var(--on-surface-color) 10%, transparent);
          padding: 2.5rem 2rem;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1.5rem;
          text-align: center;
        }

        .logo {
          width: 120px;
          height: 120px;
          object-fit: contain;
          border-radius: 50%;
          background: var(--surface-color);
          box-shadow: 0 4px 16px color-mix(in srgb, var(--on-surface-color) 15%, transparent);
          padding: 8px;
        }

        .app-name {
          font-size: 2rem;
          font-weight: 700;
          color: var(--on-surface-color);
          margin: 0;
          line-height: 1.2;
        }

        .app-version {
          font-size: 0.85rem;
          color: var(--secondary-text-color, var(--palette-text-secondary));
          font-weight: 500;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }

        .app-description {
          font-size: 1rem;
          color: var(--secondary-text-color, var(--palette-text-secondary));
          line-height: 1.7;
          max-width: 480px;
        }

        .divider {
          width: 100%;
          height: 1px;
          background: var(--divider-color, var(--palette-divider));
        }

        .meta-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem;
          width: 100%;
          text-align: left;
        }

        .meta-item {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .meta-label {
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--secondary-text-color, var(--palette-text-secondary));
        }

        .meta-value {
          font-size: 0.95rem;
          color: var(--on-surface-color);
          font-weight: 500;
        }

        .platform-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          background: color-mix(in srgb, var(--primary-color) 12%, transparent);
          color: var(--primary-color);
          border: 1px solid color-mix(in srgb, var(--primary-color) 30%, transparent);
          border-radius: 999px;
          padding: 6px 16px;
          font-size: 0.85rem;
          font-weight: 600;
        }

        .platform-badge svg {
          width: 16px;
          height: 16px;
          fill: currentColor;
          flex-shrink: 0;
        }

        .copyright {
          font-size: 0.8rem;
          color: var(--secondary-text-color, var(--palette-text-secondary));
        }
      </style>

      <div class="about-wrap">
        <div class="about-card">

          <img class="logo" src="./img/logo.png" alt="Globular logo" />

          <div>
            <h1 class="app-name">Globular Media</h1>
            <div class="app-version">Version 0.9.0</div>
          </div>

          <p class="app-description">
            A modern media browser and player built on top of the Globular platform.
            Browse, search, and stream your personal video and audio library from anywhere.
            Supports HLS adaptive streaming, timeline previews, subtitles, playlists,
            and full metadata enrichment via media services.
          </p>

          <div class="divider"></div>

          <div class="meta-grid">
            <div class="meta-item">
              <span class="meta-label">Author</span>
              <span class="meta-value">Dave Courtois</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">License</span>
              <span class="meta-value">MIT</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">Technology</span>
              <span class="meta-value">Web Components + gRPC-Web</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">Streaming</span>
              <span class="meta-value">HLS / MP4 / Audio</span>
            </div>
          </div>

          <div class="divider"></div>

          <div class="platform-badge">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/>
            </svg>
            Powered by Globular
          </div>

          <span class="copyright">© 2025 Globular Project — All rights reserved</span>

        </div>
      </div>
    `
  }
}

customElements.define('page-media-about', PageMediaAbout)
