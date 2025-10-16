// A reusable function to dispatch a window resize event.
export function fireResize() {
    window.dispatchEvent(new Event('resize'));
}

/**
 * Handles the logic for resizing a div element.
 * @param {HTMLElement} div The target div element.
 * @param {Function} onresize Callback function to execute on resize.
 * @param {string} side The side to allow resizing from ('right' or 'left').
 * @param {number} zIndex Z-index for the resize handles.
 * @param {number} headerHeight Height of a header to offset the resize.
 */
export function setResizeable(div, onresize, side = 'right', zIndex = 100, headerHeight = 0) {
    if (!(div instanceof HTMLElement)) {
        console.error('The first argument must be an HTMLElement.');
        return;
    }

    const name = div.getAttribute('name');
    const minWidth = div.minWidth || 50; // Default minimum width
    const minHeight = div.minHeight || 50; // Default minimum height
    const isMobile = () => window.innerWidth < 500;

    let isResizingWidth = false;
    let isResizingHeight = false;

    // --- 1. HANDLE MOBILE AND WINDOW RESIZE EVENTS ---
    window.addEventListener("resize", () => {
        const viewportWidth = window.innerWidth;

        // On mobile, force to full width if fixed position
        if (isMobile() && div.style.position === 'fixed') {
            div.style.width = '100vw';
        } 
        // On desktop, restore from mobile full width if needed
        else if (!isMobile() && div.style.width === '100vw' && div.maxWidth > 0) {
            div.style.width = `${div.maxWidth}px`;
            div.style.height = 'auto'; // Reset height
        }

        // Save dimensions to localStorage
        if (name) {
            localStorage.setItem(`__${name}_dimension__`, JSON.stringify({ width: div.offsetWidth, height: div.offsetHeight }));
        }

        if (onresize) {
            onresize(div.offsetWidth, div.offsetHeight);
        }
    });

    // --- 2. INITIAL SETUP AND DIMENSION RESTORATION ---
    if (isMobile() && div.style.position === 'fixed') {
        div.style.width = '100vw';
    } else if (name) {
        const savedDimensions = JSON.parse(localStorage.getItem(`__${name}_dimension__`) || '{}');
        if (savedDimensions.width > 0 && savedDimensions.height > 0) {
            div.style.width = `${savedDimensions.width}px`;
            div.style.height = `${savedDimensions.height}px`;
        } else if (div.maxWidth > 0) {
            div.style.width = `${div.maxWidth}px`;
        }
    }
    
    // --- 3. CREATE RESIZE HANDLES ---
    const createHandle = (id, styles, cursor) => {
        const handle = document.createElement('div');
        handle.id = id;
        Object.assign(handle.style, {
            position: 'absolute',
            zIndex: zIndex,
            ...styles
        });
        
        handle.addEventListener('mouseenter', () => handle.style.cursor = cursor);
        handle.addEventListener('mouseleave', () => handle.style.cursor = 'default');
        handle.addEventListener('mouseover', () => handle.style.backgroundColor = 'darkgrey');
        handle.addEventListener('mouseout', () => handle.style.backgroundColor = '');

        div.appendChild(handle);
        return handle;
    };

    // Width handle
    const widthHandle = createHandle('resize-width-handle', {
        top: '0px',
        bottom: '5px',
        width: '5px',
        [side]: '-1px'
    }, 'ew-resize');
    
    // Height handle
    const heightHandle = createHandle('resize-height-handle', {
        left: '0px',
        right: '5px',
        height: '5px',
        bottom: '-1px'
    }, 'ns-resize');
    
    // Corner handle (for both width and height)
    const cornerHandle = createHandle('resize-corner-handle', {
        bottom: '-1px',
        height: '10px',
        width: '10px',
        [side]: '-1px'
    }, 'nwse-resize');
    
    // --- 4. POINTER EVENT LISTENERS ---
    const getOffset = (el, prop) => {
        let offset = 0;
        do {
            offset += el[`offset${prop}`] || 0;
            el = el.offsetParent;
        } while (el);
        return offset;
    };

    const getElementOffsetLeft = (elem) => getOffset(elem, 'Left');
    const getElementOffsetTop = (elem) => getOffset(elem, 'Top');

    const handlePointerMove = (e) => {
        if (!isResizingWidth && !isResizingHeight) return;

        if (isMobile()) {
            // Mobile handles are disabled for this logic
            fireResize();
            return;
        }

        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        let newWidth = clientX - getElementOffsetLeft(div);
        let newHeight = clientY - getElementOffsetTop(div) - headerHeight;
        
        // Clamp dimensions to minimums
        newWidth = Math.max(newWidth, minWidth);
        newHeight = Math.max(newHeight, minHeight);
        
        if (isResizingWidth) {
            div.style.width = `${newWidth}px`;
        }
        if (isResizingHeight) {
            div.style.height = `${newHeight}px`;
        }

        if (onresize) {
            onresize(div.offsetWidth, div.offsetHeight);
        }
        
        fireResize();
    };
    
    const handlePointerDown = (e) => {
        // Only start resizing on the handles
        if (e.target !== widthHandle && e.target !== heightHandle && e.target !== cornerHandle) {
            return;
        }

        e.preventDefault(); // Prevent text selection etc.
        document.body.classList.add('resizing-active'); // Add a class to body for global cursor
        
        if (e.target === widthHandle) {
            isResizingWidth = true;
        } else if (e.target === heightHandle) {
            isResizingHeight = true;
        } else if (e.target === cornerHandle) {
            isResizingWidth = true;
            isResizingHeight = true;
        }

        // Add a cover div to prevent mouse events on the content
        const coverDiv = document.createElement("div");
        coverDiv.id = "cover-div";
        coverDiv.style.cssText = "position:fixed; top:0; left:0; width:100vw; height:100vh; z-index:99; cursor:ew-resize;";
        document.body.appendChild(coverDiv);
    };
    
    const handlePointerUp = () => {
        isResizingWidth = false;
        isResizingHeight = false;
        document.body.classList.remove('resizing-active');
        
        // Clean up the cover div
        const coverDiv = document.body.querySelector("#cover-div");
        if (coverDiv) {
            document.body.removeChild(coverDiv);
        }
    };

    document.body.addEventListener("pointerdown", handlePointerDown);
    document.body.addEventListener("pointerup", handlePointerUp);
    document.body.addEventListener("pointermove", handlePointerMove);
    
    // Cleanup listeners when the div is removed (optional, but good practice)
    const observer = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
            mutation.removedNodes.forEach(removedNode => {
                if (removedNode === div) {
                    document.body.removeEventListener("pointerdown", handlePointerDown);
                    document.body.removeEventListener("pointerup", handlePointerUp);
                    document.body.removeEventListener("pointermove", handlePointerMove);
                    observer.disconnect();
                }
            });
        });
    });
    observer.observe(document.body, { childList: true });
}

// Add a global CSS rule for the cursor
const style = document.createElement('style');
style.innerHTML = `
    .resizing-active, .resizing-active * {
        cursor: ew-resize !important;
        user-select: none;
    }
`;
document.head.appendChild(style);