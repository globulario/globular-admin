class PageClusterOverview extends HTMLElement {
  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <section style="padding:16px">
        <h2>Cluster Overview</h2>
        <p>Peers, CPU/RAM, storage, service health.</p>
      </section>
    `
  }
}
customElements.define('page-cluster-overview', PageClusterOverview)