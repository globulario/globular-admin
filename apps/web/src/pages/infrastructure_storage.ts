class PageInfrastructureStorage extends HTMLElement {
  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <section class="wrap">
        <h2>Storage</h2>
        <p>Data backend health: repository, persistence, object store capacity, etcd quorum status, and backup/restore actions.</p>
      </section>
    `
  }
}
customElements.define('page-infrastructure-storage', PageInfrastructureStorage)
