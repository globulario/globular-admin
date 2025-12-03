class PageMedia extends HTMLElement {
  connectedCallback() {
    this.style.display = "block";
    this.innerHTML = `
      <section class="wrap">
        <h2>Media Settings</h2>
        <p>Configure media processing and conversion policies here.</p>
        <globular-media-settings></globular-media-settings>
      </section>
    `;
  }
}

customElements.define("page-media", PageMedia);

import "../components/media/mediaSettings.js";
