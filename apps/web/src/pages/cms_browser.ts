import "../components/fileExplorer/fileExplorer.js"

class PageCmsBrowser extends HTMLElement {
  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <section style="padding:16px">
        <h2>CMS — File Browser</h2>
        <p>Browse server files, shares, permissions.</p>
        <globular-file-explorer></globular-file-explorer>
      </section>
    `
  }
}
customElements.define('page-cms-browser', PageCmsBrowser)