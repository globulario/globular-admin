class PageStorageScylla extends HTMLElement {
  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <section class="wrap">
        <h2>ScyllaDB</h2>
        <p>Node status, keyspaces, replication, and consistency warnings.</p>
      </section>
    `
  }
}
customElements.define('page-storage-scylla', PageStorageScylla)
