class PageNetworkingDns extends HTMLElement {
  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <section class="wrap">
        <h2>Networking DNS</h2>
        <p>Cluster DNS records, node discovery, and validation checks.</p>
      </section>
    `
  }
}
customElements.define('page-networking-dns', PageNetworkingDns)
