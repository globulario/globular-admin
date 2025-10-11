class PageClusterServices extends HTMLElement {
  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <section style="padding:16px">
        <h2>Cluster Services</h2>
        <p>Registered services, versions, endpoints.</p>
      </section>
    `
  }
}
customElements.define('page-cluster-services', PageClusterServices)