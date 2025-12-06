class PageMediaSettings extends HTMLElement {
  connectedCallback() {
    this.style.display = "block";
    this.innerHTML = `
      <style>
        :host {
          display: block;
        }
        section.wrap {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .settings-shell {
          flex: 1;
          min-height: 600px;
          border: 1px solid var(--border-subtle-color);
          border-radius: 12px;
          background: var(--surface-elevated-color, var(--surface-color));
          box-shadow: 0 6px 18px color-mix(in srgb, var(--on-surface-color) 12%, transparent);
          padding: 16px;
          box-sizing: border-box;
        }
      </style>
      <section class="wrap">
        <h2>Media Settings</h2>
        <p>Configure media processing and conversion policies here.</p>
        <globular-media-settings style="display:block;height:100%;"></globular-media-settings>
      </section>
    `;
  }
}

customElements.define("page-media-settings", PageMediaSettings);

import "@globular/components/media/mediaSettings.js";
