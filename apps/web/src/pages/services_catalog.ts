class PageServicesCatalog extends HTMLElement {
  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <section class="wrap">
        <h2>Services Catalog</h2>
        <p>List of registered services, versions, and desired states.</p>
      </section>
    `
  }
}
customElements.define('page-services-catalog', PageServicesCatalog)
