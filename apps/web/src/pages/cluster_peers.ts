class PageClusterPeers extends HTMLElement {
  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <section style="padding:16px">
        <h2>Cluster Peers</h2>
        <p>List peers/nodes and their status.</p>
      </section>
    `
  }
}
customElements.define('page-cluster-peers', PageClusterPeers)