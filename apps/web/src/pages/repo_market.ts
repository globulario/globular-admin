class PageRepository extends HTMLElement {
  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <section class="wrap">
        <h2>Repository</h2>
        <p>Discover and install services/packages.</p>
      </section>
    `
  }
}
customElements.define('page-repository', PageRepository)