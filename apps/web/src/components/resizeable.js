// A reusable function to dispatch a window resize event.
export function fireResize() {
  window.dispatchEvent(new Event('resize'));
}

/**
 * Make a div resizable with handles (works in light DOM or Shadow DOM).
 * @param {HTMLElement} div        The target div element.
 * @param {Function}    onresize   Callback (w,h) after each drag frame.
 * @param {string}      side       'right' (default) or 'left' handle for width.
 * @param {number}      zIndex     Z-index for the resize handles.
 * @param {number}      headerHeight Height to subtract from vertical drag (e.g., header).
 */
export function setResizeable(div, onresize, side = 'right', zIndex = 100, headerHeight = 0) {
  if (!(div instanceof HTMLElement)) {
    console.error('The first argument must be an HTMLElement.');
    return;
  }

  // Ensure the container is positioned so absolute handles work properly.
  const pos = getComputedStyle(div).position;
  if (!['relative', 'absolute', 'fixed'].includes(pos)) {
    div.style.position = 'relative';
  }

  const name = div.getAttribute('name') || '';
  const isMobile = () => window.innerWidth < 500;

  // Use explicit numeric properties if you set them on `div`, otherwise fallback to CSS or default.
  const cssMinW = parseInt(getComputedStyle(div).minWidth || '', 10);
  const cssMinH = parseInt(getComputedStyle(div).minHeight || '', 10);
  const minWidth  = Number(div.minWidth)  || (Number.isFinite(cssMinW) ? cssMinW : 50);
  const minHeight = Number(div.minHeight) || (Number.isFinite(cssMinH) ? cssMinH : 50);

  const cssMaxW = parseInt(getComputedStyle(div).maxWidth || '', 10);
  const maxWidth = Number(div.maxWidth) || (Number.isFinite(cssMaxW) ? cssMaxW : 0); // 0 means "no max"

  let isResizingWidth = false;
  let isResizingHeight = false;

  // ---------- 1) Handle window resize (mobile/full-width + persistence) ----------
  const onWindowResize = () => {
    if (isMobile() && getComputedStyle(div).position === 'fixed') {
      // Force full width on mobile when fixed.
      div.style.width = '100vw';
    } else if (!isMobile() && div.style.width === '100vw' && maxWidth > 0) {
      div.style.width = `${maxWidth}px`;
      div.style.height = 'auto';
    }

    if (name) {
      localStorage.setItem(
        `__${name}_dimension__`,
        JSON.stringify({ width: div.offsetWidth, height: div.offsetHeight })
      );
    }

    onresize?.(div.offsetWidth, div.offsetHeight);
  };

  window.addEventListener('resize', onWindowResize);

  // ---------- 2) Initial setup / restore persisted dimensions ----------
  if (isMobile() && getComputedStyle(div).position === 'fixed') {
    div.style.width = '100vw';
  } else if (name) {
    const saved = JSON.parse(localStorage.getItem(`__${name}_dimension__`) || '{}');
    if (saved.width > 0 && saved.height > 0) {
      div.style.width = `${saved.width}px`;
      div.style.height = `${saved.height}px`;
    } else if (maxWidth > 0) {
      div.style.width = `${maxWidth}px`;
    }
  }

  // ---------- 3) Create resize handles ----------
  const createHandle = (id, styles, cursor) => {
    const handle = document.createElement('div');
    handle.id = id;
    Object.assign(handle.style, {
      position: 'absolute',
      zIndex,
      ...styles,
    });

    // Visual / pointer affordances
    handle.addEventListener('mouseenter', () => (handle.style.cursor = cursor));
    handle.addEventListener('mouseleave', () => (handle.style.cursor = 'default'));
    handle.addEventListener('mouseover',  () => (handle.style.backgroundColor = 'darkgrey'));
    handle.addEventListener('mouseout',   () => (handle.style.backgroundColor = ''));

    // Better drag capture (keeps events flowing even if pointer leaves the handle)
    handle.addEventListener('pointerdown', (e) => {
      try { handle.setPointerCapture(e.pointerId); } catch { /* no-op */ }
    });

    div.appendChild(handle);
    return handle;
  };

  // Vertical edge for width
  const widthHandle = createHandle(
    'resize-width-handle',
    { top: '0px', bottom: '5px', width: '5px', [side]: '-1px' },
    'ew-resize'
  );

  // Horizontal edge for height
  const heightHandle = createHandle(
    'resize-height-handle',
    { left: '0px', right: '5px', height: '5px', bottom: '-1px' },
    'ns-resize'
  );

  // Corner (both)
  const cornerHandle = createHandle(
    'resize-corner-handle',
    { bottom: '-1px', height: '10px', width: '10px', [side]: '-1px' },
    'nwse-resize'
  );

  // ---------- 4) Pointer listeners (Shadow DOM-safe) ----------
  const root = div.getRootNode();
  const eventTarget = root instanceof ShadowRoot ? root : document;

  const getOffset = (el, prop) => {
    let offset = 0;
    while (el) {
      offset += el[`offset${prop}`] || 0;
      el = el.offsetParent;
    }
    return offset;
  };
  const getElementOffsetLeft = (elem) => getOffset(elem, 'Left');
  const getElementOffsetTop  = (elem) => getOffset(elem, 'Top');

  const handlePointerMove = (e) => {
    if (!isResizingWidth && !isResizingHeight) return;

    if (isMobile()) {
      fireResize();
      return;
    }

    const pt = e.touches ? e.touches[0] : e;
    const clientX = pt.clientX;
    const clientY = pt.clientY;

    const leftPage = getElementOffsetLeft(div);
    const topPage  = getElementOffsetTop(div);

    // For left-side drag we need accurate rects against the same coordinate space as style.left
    const rect        = div.getBoundingClientRect();
    const parentRect  = div.offsetParent ? div.offsetParent.getBoundingClientRect() : { left: 0, top: 0 };

    let newWidth = div.offsetWidth;
    let newHeight = div.offsetHeight;

    if (isResizingWidth) {
      if (side === 'right') {
        // Expand/shrink to the right edge
        newWidth = clientX - leftPage;
      } else {
        // Expand/shrink from the left edge: keep right edge fixed.
        const rightPx = rect.right;
        newWidth = Math.max(rightPx - clientX, minWidth);

        // Move the left edge to follow the pointer so the right edge stays in place.
        const newLeft = Math.round(clientX - parentRect.left);
        div.style.left = `${newLeft}px`;
      }
      newWidth = Math.max(newWidth, minWidth);
      if (maxWidth > 0) newWidth = Math.min(newWidth, maxWidth);
      div.style.width = `${newWidth}px`;
    }

    if (isResizingHeight) {
      newHeight = clientY - topPage - headerHeight;
      newHeight = Math.max(newHeight, minHeight);
      div.style.height = `${newHeight}px`;
    }

    onresize?.(div.offsetWidth, div.offsetHeight);
    fireResize();
  };

  const handlePointerDown = (e) => {
    // Use composedPath so events crossing shadow boundaries still find the handle.
    const path = e.composedPath?.() || [];
    const hitWidth  = path.includes(widthHandle);
    const hitHeight = path.includes(heightHandle);
    const hitCorner = path.includes(cornerHandle);
    if (!hitWidth && !hitHeight && !hitCorner) return;

    e.preventDefault();
    document.body.classList.add('resizing-active');

    isResizingWidth  = hitWidth || hitCorner;
    isResizingHeight = hitHeight || hitCorner;

    const cursor =
      isResizingWidth && isResizingHeight ? 'nwse-resize'
      : isResizingWidth ? 'ew-resize'
      : 'ns-resize';

    // A cover div prevents unwanted selections/clicks while dragging.
    const coverDiv = document.createElement('div');
    coverDiv.id = 'cover-div';
    coverDiv.style.cssText = `
      position:fixed; top:0; left:0; width:100vw; height:100vh;
      z-index:${zIndex + 1}; cursor:${cursor};
    `;
    document.body.appendChild(coverDiv);
  };

  const handlePointerUp = () => {
    if (!isResizingWidth && !isResizingHeight) return;

    isResizingWidth = false;
    isResizingHeight = false;
    document.body.classList.remove('resizing-active');

    const coverDiv = document.body.querySelector('#cover-div');
    if (coverDiv) coverDiv.remove();

    // Persist final size
    if (name) {
      localStorage.setItem(
        `__${name}_dimension__`,
        JSON.stringify({ width: div.offsetWidth, height: div.offsetHeight })
      );
    }
  };

  eventTarget.addEventListener('pointerdown', handlePointerDown);
  eventTarget.addEventListener('pointerup',   handlePointerUp);
  eventTarget.addEventListener('pointermove', handlePointerMove);

  // ---------- 5) Cleanup when the element (or its ancestors) are removed ----------
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const n of m.removedNodes) {
        // If the removed node is the div or contains it (covers shadow/light DOM removals)
        if (n === div || (n.nodeType === 1 && n.contains?.(div))) {
          eventTarget.removeEventListener('pointerdown', handlePointerDown);
          eventTarget.removeEventListener('pointerup',   handlePointerUp);
          eventTarget.removeEventListener('pointermove', handlePointerMove);
          window.removeEventListener('resize', onWindowResize);
          observer.disconnect();
          return;
        }
      }
    }
  });
  // Observe broadly so we catch removal even if it happens up-tree/shadow host replacements.
  observer.observe(document.body, { childList: true, subtree: true });
}

// Add a global CSS rule for the cursor during resize drags.
const style = document.createElement('style');
style.innerHTML = `
  .resizing-active, .resizing-active * {
    cursor: ew-resize !important;
    user-select: none !important;
  }
`;
document.head.appendChild(style);
