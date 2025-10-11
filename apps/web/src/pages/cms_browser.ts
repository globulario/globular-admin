class PageCmsBrowser extends HTMLElement {
  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <section style="padding:16px">
        <h2>CMS — File Browser</h2>
        <p>Browse server files, shares, permissions.</p>
      </section>
    `
  }
}
customElements.define('page-cms-browser', PageCmsBrowser)