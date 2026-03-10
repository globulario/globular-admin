// src/utils/confirm_dialog.ts
// Lightweight confirm/alert modal that matches the admin Material theme.

const DIALOG_STYLES = `
  .confirm-overlay {
    position: fixed; inset: 0; z-index: 10000;
    display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,.55);
    animation: confirmFadeIn .15s ease;
  }
  .confirm-box {
    background: var(--surface-color, #1e1e2e);
    color: var(--on-surface-color, #cdd6f4);
    border-radius: .5rem;
    box-shadow: 0 8px 32px rgba(0,0,0,.4);
    min-width: 340px; max-width: 480px;
    font-family: Roboto, sans-serif;
    overflow: hidden;
    animation: confirmSlideUp .2s ease;
  }
  .confirm-header {
    display: flex; align-items: center; gap: .5rem;
    padding: .75rem 1rem;
    background: var(--surface-variant, #2a2a3c);
    border-bottom: 1px solid rgba(255,255,255,.08);
    font-weight: 500; font-size: .95rem;
  }
  .confirm-header i {
    font-size: 1.1rem;
  }
  .confirm-body {
    padding: 1rem 1.25rem;
    font-size: .875rem;
    line-height: 1.5;
    white-space: pre-line;
  }
  .confirm-footer {
    display: flex; justify-content: flex-end; gap: .5rem;
    padding: .625rem 1rem;
    border-top: 1px solid rgba(255,255,255,.06);
  }
  .confirm-btn {
    border: none; border-radius: .25rem; cursor: pointer;
    padding: .45rem 1.1rem; font-size: .8rem; font-weight: 500;
    font-family: Roboto, sans-serif; letter-spacing: .02em;
    transition: background .15s, opacity .15s;
  }
  .confirm-btn:hover { opacity: .85; }
  .confirm-btn-cancel {
    background: transparent;
    color: var(--on-surface-color, #cdd6f4);
    border: 1px solid rgba(255,255,255,.15);
  }
  .confirm-btn-ok {
    background: var(--primary-color, #89b4fa);
    color: var(--on-primary-color, #1e1e2e);
  }
  .confirm-btn-danger {
    background: var(--error-color, #f38ba8);
    color: var(--on-error-color, #1e1e2e);
  }
  @keyframes confirmFadeIn { from { opacity: 0 } to { opacity: 1 } }
  @keyframes confirmSlideUp { from { transform: translateY(12px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
`

let styleInjected = false
function injectStyles() {
  if (styleInjected) return
  const s = document.createElement('style')
  s.textContent = DIALOG_STYLES
  document.head.appendChild(s)
  styleInjected = true
}

export interface ConfirmOptions {
  title?: string
  message: string
  okLabel?: string
  cancelLabel?: string
  variant?: 'default' | 'danger'
  icon?: string   // FontAwesome class, e.g. "fa fa-shield"
}

/**
 * Show a styled confirm dialog. Returns a promise that resolves to true (OK)
 * or false (Cancel).
 */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  injectStyles()
  return new Promise(resolve => {
    const overlay = document.createElement('div')
    overlay.className = 'confirm-overlay'

    const iconClass = opts.icon ?? (opts.variant === 'danger' ? 'fa fa-exclamation-triangle' : 'fa fa-question-circle')
    const iconColor = opts.variant === 'danger' ? 'var(--error-color, #f38ba8)' : 'var(--primary-color, #89b4fa)'
    const btnClass = opts.variant === 'danger' ? 'confirm-btn-danger' : 'confirm-btn-ok'

    overlay.innerHTML = `
      <div class="confirm-box">
        <div class="confirm-header">
          <i class="${iconClass}" style="color:${iconColor}"></i>
          <span>${opts.title ?? 'Confirm'}</span>
        </div>
        <div class="confirm-body">${opts.message}</div>
        <div class="confirm-footer">
          <button class="confirm-btn confirm-btn-cancel" data-role="cancel">${opts.cancelLabel ?? 'Cancel'}</button>
          <button class="confirm-btn ${btnClass}" data-role="ok">${opts.okLabel ?? 'OK'}</button>
        </div>
      </div>
    `

    function close(result: boolean) {
      overlay.remove()
      resolve(result)
    }

    overlay.querySelector('[data-role="ok"]')!.addEventListener('click', () => close(true))
    overlay.querySelector('[data-role="cancel"]')!.addEventListener('click', () => close(false))
    overlay.addEventListener('click', e => { if (e.target === overlay) close(false) })
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); close(false) }
      if (e.key === 'Enter') { document.removeEventListener('keydown', onKey); close(true) }
    })

    document.body.appendChild(overlay)
    ;(overlay.querySelector('[data-role="ok"]') as HTMLElement).focus()
  })
}

/**
 * Show a styled alert dialog (OK button only).
 */
export function alertDialog(opts: Omit<ConfirmOptions, 'cancelLabel'> & { okLabel?: string }): Promise<void> {
  injectStyles()
  return new Promise(resolve => {
    const overlay = document.createElement('div')
    overlay.className = 'confirm-overlay'

    const iconClass = opts.icon ?? 'fa fa-info-circle'
    const iconColor = opts.variant === 'danger' ? 'var(--error-color, #f38ba8)' : 'var(--primary-color, #89b4fa)'

    overlay.innerHTML = `
      <div class="confirm-box">
        <div class="confirm-header">
          <i class="${iconClass}" style="color:${iconColor}"></i>
          <span>${opts.title ?? 'Notice'}</span>
        </div>
        <div class="confirm-body">${opts.message}</div>
        <div class="confirm-footer">
          <button class="confirm-btn confirm-btn-ok" data-role="ok">${opts.okLabel ?? 'OK'}</button>
        </div>
      </div>
    `

    function close() { overlay.remove(); resolve() }

    overlay.querySelector('[data-role="ok"]')!.addEventListener('click', close)
    overlay.addEventListener('click', e => { if (e.target === overlay) close() })
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape' || e.key === 'Enter') { document.removeEventListener('keydown', onKey); close() }
    })

    document.body.appendChild(overlay)
    ;(overlay.querySelector('[data-role="ok"]') as HTMLElement).focus()
  })
}
