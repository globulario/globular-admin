class PageNetworkingGateway extends HTMLElement {
  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <section class="wrap">
        <h2>Networking Gateway</h2>
        <p>Envoy health, listeners, routes, and upstream insights.</p>
      </section>
    `
  }
}
customElements.define('page-networking-gateway', PageNetworkingGateway)
