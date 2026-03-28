class PageMediaSettings extends HTMLElement {
  connectedCallback() {
    this.style.display = "block";
    this.innerHTML = `
      <style>
        :host {
          display: block;
          scrollbar-width: thin;
          scrollbar-color: var(--scroll-thumb, var(--palette-divider))
                          var(--scroll-track, var(--surface-color));
        }
        section.wrap {
          display: flex;
          flex-direction: column;
          box-sizing: border-box;
          padding: 8px;
        }
      </style>
      <section class="wrap">
        <globular-media-settings style="display:flex;"></globular-media-settings>
      </section>
    `;
  }
}

customElements.define("page-media-settings", PageMediaSettings);

import "@globular/media/media/mediaSettings.js";
