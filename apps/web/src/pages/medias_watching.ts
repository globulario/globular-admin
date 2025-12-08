import "@globular/components/watching.js";

class PageMediaWatching extends HTMLElement {
  connectedCallback() {
    this.style.display = "block";
    this.innerHTML = `
       <globular-media-watching closable="false"></globular-media-watching>
    `;
  }
}

customElements.define("page-media-watching", PageMediaWatching);
