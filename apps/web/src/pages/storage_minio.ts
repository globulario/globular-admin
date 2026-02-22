class PageStorageMinio extends HTMLElement {
  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <section class="wrap">
        <h2>MinIO</h2>
        <p>Endpoint status, bucket overview, and replication health.</p>
      </section>
    `
  }
}
customElements.define('page-storage-minio', PageStorageMinio)
