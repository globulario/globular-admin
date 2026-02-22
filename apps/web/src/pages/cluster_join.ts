class PageClusterJoin extends HTMLElement {
  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <section class="wrap">
        <h2>Cluster Join Requests</h2>
        <p>Pending peer approvals and drag/drop registration exist here.</p>
      </section>
    `
  }
}
customElements.define('page-cluster-join', PageClusterJoin)
