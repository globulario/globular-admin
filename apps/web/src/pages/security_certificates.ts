class PageSecurityCertificates extends HTMLElement {
  connectedCallback() {
    this.style.display = 'block'
    this.innerHTML = `
      <section class="wrap">
        <h2>Certificates</h2>
        <p>CA status, node and service cert expiry, SAN lists, mTLS status, and rotation actions.</p>
      </section>
    `
  }
}
customElements.define('page-security-certificates', PageSecurityCertificates)
