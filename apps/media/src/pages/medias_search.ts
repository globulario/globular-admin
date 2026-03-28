import "@globular/media/search/searchResults.js";

class PageMediaSearch extends HTMLElement {
  connectedCallback() {
    this.style.display = "block";
    this.innerHTML = `
      <section class="wrap">
        <globular-search-results persistent></globular-search-results>
      </section>
    `;
  }
}

customElements.define("page-media-search", PageMediaSearch);
