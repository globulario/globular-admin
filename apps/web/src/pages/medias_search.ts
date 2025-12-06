import "@globular/components/search/searchBar.js";
import "@globular/components/search/searchResults.js";

class PageMediaSearch extends HTMLElement {
  connectedCallback() {
    this.style.display = "block";
    this.innerHTML = `
      <section class="wrap">
        <h2>Media Search</h2>
        <p>Search through indexed titles, videos, audios, and blog posts.</p>
        <div style="margin-top: 1.5rem; display: flex; flex-direction: column; gap: 1.5rem;">
          <globular-search-bar></globular-search-bar>
          <globular-search-results></globular-search-results>
        </div>
      </section>
    `;
  }
}

customElements.define("page-media-search", PageMediaSearch);
