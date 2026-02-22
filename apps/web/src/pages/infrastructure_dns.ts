class PageInfrastructureDns extends HTMLElement {
  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <section class="wrap">
        <h2>DNS</h2>
        <p>Domain ownership, record diff vs desired state, unresolvable records, wildcard conflicts, and zone import/export.</p>
      </section>
    `
  }
}
customElements.define('page-infrastructure-dns', PageInfrastructureDns)
