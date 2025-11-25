class PageClusterApps extends HTMLElement {
  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <section class="wrap">
        <h2>Cluster Applications</h2>
        <p>Installed apps and packages.</p>
      </section>
    `
  }
}
customElements.define('page-cluster-apps', PageClusterApps)
