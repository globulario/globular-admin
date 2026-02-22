class PageServicesInstances extends HTMLElement {
  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <section class="wrap">
        <h2>Service Instances</h2>
        <p>Matrix showing which services run on which nodes.</p>
      </section>
    `
  }
}
customElements.define('page-services-instances', PageServicesInstances)
