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
          background: color-mix(in srgb, var(--surface-color) 92%, transparent);
          border: 1px solid color-mix(in srgb, var(--palette-divider) 40%, transparent);
          border-radius: 12px;
          box-shadow: 0 2px 8px rgba(0,0,0,.08);
          padding: 2rem 1.5rem;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1.5rem;
          text-align: center;
        }

        .logo {
          width: 100px;
          height: 100px;
          object-fit: contain;
          border-radius: 50%;
          background: transparent;
          box-shadow: none;
          padding: 0;
        }

        .app-name {
          font-size: 1.4rem;
          font-weight: 600;
          color: var(--on-surface-color);
          margin: 0;
          line-height: 1.2;
        }

        .app-version {
          font-size: 0.75rem;
          color: var(--secondary-text-color, var(--palette-text-secondary));
          font-weight: 500;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          margin-top: 4px;
        }

        .app-description {
          font-size: .88rem;
          color: var(--secondary-text-color, var(--palette-text-secondary));
          line-height: 1.6;
          max-width: 480px;
        }

        .divider {
          width: 100%;
          height: 1px;
          background: color-mix(in srgb, var(--divider-color, var(--palette-divider)) 40%, transparent);
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
          background: color-mix(in srgb, var(--accent-color, #2196F3) 8%, transparent);
          color: var(--secondary-text-color);
          border: 1px solid color-mix(in srgb, var(--accent-color, #2196F3) 20%, transparent);
          border-radius: 999px;
          padding: 5px 14px;
          font-size: 0.78rem;
          font-weight: 500;
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

        @media (max-width: 600px) {
          .about-wrap {
            padding: 1.5rem 0.75rem;
          }
          .about-card {
            padding: 1.5rem 1rem;
          }
          .meta-grid {
            grid-template-columns: 1fr;
          }
          .logo {
            width: 90px;
            height: 90px;
          }
          .app-name {
            font-size: 1.5rem;
          }
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
