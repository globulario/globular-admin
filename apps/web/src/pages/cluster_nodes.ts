class PageClusterNodes extends HTMLElement {
  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <section class="wrap">
        <h2>Cluster Nodes</h2>
        <p>Node inventory, health, and quick actions live here.</p>
      </section>
    `
  }
}
customElements.define('page-cluster-nodes', PageClusterNodes)
