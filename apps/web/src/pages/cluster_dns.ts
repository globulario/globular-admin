class PageClusterDns extends HTMLElement {
  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <section style="padding:16px">
        <h2>DNS</h2>
        <p>Hosts, domains, ACME certificates, records.</p>
      </section>
    `
  }
}
customElements.define('page-cluster-dns', PageClusterDns)