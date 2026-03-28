import '@globular/ui/styles/theme.css'
import '@globular/ui/styles/components.css'
import './styles/styles.css'

import "@globular/components/applicationLayout.js"
import '@globular/ui' // registers theme-toggle, user-toolbar
import "@globular/media/search/searchBar.js"

import "@fortawesome/fontawesome-free/css/all.min.css"
import 'toastify-js/src/toastify.css'

import { initGlobularApp } from '@globular/ui'
import { startRouter, navigateTo, clearPageCache } from './router'

// Standalone file explorer button for the action bar
class FileExplorerButton extends HTMLElement {
  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
    this.shadowRoot!.innerHTML = `
      <style>
        :host { display: inline-flex; align-items: center; }
        button {
          background: transparent; border: none; cursor: pointer;
          color: var(--on-primary-color, #fff);
          width: 38px; height: 38px; padding: 6px;
          display: inline-flex; align-items: center; justify-content: center;
          border-radius: 6px; opacity: .7; transition: opacity .2s;
        }
        button:hover { opacity: 1; background: rgba(255,255,255,.08); }
        svg { width: 24px; height: 24px; fill: currentColor; }
      </style>
      <button title="Open File Explorer">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
          <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
        </svg>
      </button>
    `
    this.shadowRoot!.querySelector('button')!.onclick = () => {
      const Ctor = customElements.get('globular-file-explorer') as (new () => HTMLElement) | undefined
      if (!Ctor) return
      const explorer = new Ctor()
      explorer.setAttribute('data-source', 'action-bar')
      const close = () => { explorer.removeEventListener('dialog-closed', close); explorer.remove() }
      explorer.addEventListener('dialog-closed', close as any)
      document.body.appendChild(explorer)
    }
  }
}
customElements.define('file-explorer-btn', FileExplorerButton)

initGlobularApp({ onNavigate: navigateTo })

startRouter()

// Show search results when search bar is focused, return to previous page on blur
let preSearchRoute = ''
document.addEventListener('search-focus', () => {
  if (window.location.hash !== '#/media/search') {
    preSearchRoute = window.location.hash || '#/media/watching'
    navigateTo('#/media/search')
  }
})
document.addEventListener('search-blur', () => {
  // Only navigate back if search input is empty AND no search results are showing
  const searchBar = document.querySelector('globular-search-bar') as any
  const input = searchBar?.shadowRoot?.querySelector('#search_input') as HTMLInputElement | null
  const searchResults = document.querySelector('globular-search-results') as any
  const hasTabs = searchResults?.shadowRoot?.querySelector('#search-results-tabs')?.items?.length > 0
  if (preSearchRoute && (!input || !input.value.trim()) && !hasTabs) {
    navigateTo(preSearchRoute)
    preSearchRoute = ''
  }
})

// Clear cached pages on logout so stale content never bleeds into a new session
window.addEventListener('auth:changed', () => {
  if (!sessionStorage.getItem('__globular_token__')) clearPageCache()
})
