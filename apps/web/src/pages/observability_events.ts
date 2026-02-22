class PageObservabilityEvents extends HTMLElement {
  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <section class="wrap">
        <h2>Events</h2>
        <p>Live and historical cluster events. Filter by node, service, severity, and correlation ID.</p>
      </section>
    `
  }
}
customElements.define('page-observability-events', PageObservabilityEvents)
