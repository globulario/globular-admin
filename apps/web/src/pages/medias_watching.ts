import "@globular/components/watching.js";

class PageMediaWatching extends HTMLElement {
  connectedCallback() {
    this.style.display = "block";
    this.innerHTML = `
      <section class="wrap">
        <h2>Continue Watching</h2>
        <p>Resume recently played titles or videos.</p>
        <div style="margin-top: 1.5rem; position: relative; min-height: 500px;">
          <globular-media-watching closable="false"></globular-media-watching>
        </div>
      </section>
    `;
  }
}

customElements.define("page-media-watching", PageMediaWatching);
