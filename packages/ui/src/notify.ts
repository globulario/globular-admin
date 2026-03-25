// Toast notification functions — moved from @globular/sdk to @globular/ui
// so components can show notifications without depending on the SDK.

import Toastify from "toastify-js"

type MessageType = "info" | "error" | "success" | "question"

interface DisplayOptions {
  duration?: number
  close?: boolean
  gravity?: "top" | "bottom"
}

function showToast(type: MessageType, content: string, options: DisplayOptions = {}) {
  const { duration = 3000, close = true } = options

  const icons: Record<MessageType, string> = {
    info: "",
    error: `<i class="fa fa-exclamation-triangle" style="color: var(--error-color); margin-right: .5rem;"></i>`,
    success: `<i class="fa fa-check-circle" style="color: var(--success-color); margin-right: .5rem;"></i>`,
    question: `<i class="fa fa-question-circle" style="color: var(--primary-color); margin-right: .5rem;"></i>`,
  }

  const container = document.createElement("div")
  container.innerHTML = `${icons[type]}<span id="toast-content">${content}</span>`
  container.style.display = "flex"
  container.style.alignItems = "center"
  container.style.justifyContent = "flex-start"
  container.style.gap = "0.4rem"
  container.style.maxWidth = "640px"
  container.style.minWidth = "200px"
  container.style.boxSizing = "border-box"
  container.style.wordBreak = "break-word"

  const toastContent = container.querySelector("#toast-content") as HTMLElement
  if (toastContent) {
    toastContent.style.overflowWrap = "anywhere"
    toastContent.style.wordBreak = "break-word"
  }

  const toast = Toastify({
    node: container,
    duration,
    close,
    gravity: 'top',
    style: {
      background: "var(--surface-color)",
      borderRadius: ".25rem",
      fontFamily: "Roboto",
      fontSize: "1rem",
      color: "var(--on-surface-color)",
      padding: ".5rem 1rem",
    },
  })

  toast.showToast()
  return toast
}

export function displayMessage(msg: string, duration = 3000) {
  return showToast("info", msg, { duration, close: false })
}

export function displayError(err: string, duration = 3000) {
  return showToast("error", err, { duration, close: true })
}

export function displaySuccess(msg: string, duration = 3000) {
  return showToast("success", msg, { duration, close: true })
}

export function displayQuestion(msg: string, duration = 3000) {
  return showToast("question", msg, { duration, close: false })
}
