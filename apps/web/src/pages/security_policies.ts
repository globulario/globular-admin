class PageSecurityPolicies extends HTMLElement {
  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <section class="wrap">
        <h2>Security Policies</h2>
        <p>Cluster policies, allowed registries, and network restrictions.</p>
      </section>
    `
  }
}
customElements.define('page-security-policies', PageSecurityPolicies)
