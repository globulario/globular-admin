class PageMediaSettings extends HTMLElement {
  connectedCallback() {
    this.style.display = "block";
    this.style.height = "100%";
    this.style.boxSizing = "border-box";
    this.innerHTML = `
      <globular-media-settings style="display:flex;flex-direction:column;height:100%;box-sizing:border-box;overflow-y:auto;padding:12px 14px;"></globular-media-settings>
    `;
  }
}

customElements.define("page-media-settings", PageMediaSettings);

import "@globular/media/media/mediaSettings.js";
