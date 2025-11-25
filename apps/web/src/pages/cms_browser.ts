import "../components/fileExplorer/fileExplorer.js"

class PageCmsBrowser extends HTMLElement {
  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <section class="wrap">
        <h2>CMS — File Browser</h2>
        <p>Browse server files, shares, permissions.</p>
        <globular-file-explorer></globular-file-explorer>
      </section>
    `
  }
}
customElements.define('page-cms-browser', PageCmsBrowser)
