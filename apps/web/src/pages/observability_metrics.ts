class PageObservabilityMetrics extends HTMLElement {
  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <section class="wrap">
        <h2>Metrics</h2>
        <p>Golden signals: latency, error rate, request rate, resource saturation, and service-specific panels.</p>
      </section>
    `
  }
}
customElements.define('page-observability-metrics', PageObservabilityMetrics)
