class PageServicesDetail extends HTMLElement {
  connectedCallback() {
    this.style.display = 'block'
    const name = this.getAttribute('service-name') || 'Unknown Service'
    this.innerHTML = `
      <section class="wrap">
        <h2>Service Detail: ${name}</h2>
        <p>Config, logs, endpoints, and API introspection for ${name}.</p>
      </section>
    `
  }
}
customElements.define('page-service-detail', PageServicesDetail)
