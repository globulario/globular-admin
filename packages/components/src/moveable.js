/**
 * Makes an HTML element draggable by a specified handle.
 * The element's position will be absolute or fixed.
 * Its position can be persisted in localStorage.
 *
 * @param {HTMLElement} handle The element that triggers the drag (e.g., the header of a dialog).
 * @param {HTMLElement} draggable The element that will be moved. Its `position` style will be set to "fixed".
 * @param {function(number, number): void} [onmove] Optional callback function `(left, top)` called during dragging.
 * @param {HTMLElement} [elementForClass] The element to apply "draggable" class and z-index to (often the `draggable` itself or its parent component).
 * @param {number} [offsetTop=0] A vertical offset to limit movement (e.g., if there's a top app bar).
 */
export function setMoveable(handle, draggable, onmove, elementForClass, offsetTop = 0) {
    if (!handle || !draggable) {
        console.error("setMoveable: Handle and draggable elements must be provided.");
        return;
    }

    // Ensure draggable element's position is fixed for consistent behavior
    draggable.style.position = "fixed";
    handle.style.userSelect = "none"; // Prevent text selection during drag

    // Add a class to the element that will be visually highlighted as draggable
    if (elementForClass) {
        elementForClass.classList.add("draggable");
    } else {
        draggable.classList.add("draggable"); // Default to draggable itself
    }

    // --- Internal State ---
    let _isMouseDown = false;
    let _initialPointerX = 0;
    let _initialPointerY = 0;
    let _initialDraggableX = 0;
    let _initialDraggableY = 0;

    // --- Constants for localStorage ---
    const _POSITION_STORAGE_PREFIX = "__dialog_position__"; // Updated prefix
    const _DRAGGABLE_NAME_ATTR = "name"; // Attribute on draggable to use for localStorage ID

    // --- Helper for localStorage ID ---
    const _getLocalStorageId = () => {
        const nameAttr = draggable.getAttribute(_DRAGGABLE_NAME_ATTR);
        return nameAttr ? `${_POSITION_STORAGE_PREFIX}${nameAttr}` : null;
    };

    // --- Restore Position from localStorage ---
    const _restorePosition = () => {
        const id = _getLocalStorageId();
        if (id && localStorage.getItem(id)) {
            try {
                let position = JSON.parse(localStorage.getItem(id));

                // Apply position constraints from `offsetTop` and viewport bounds
                position.top = Math.max(offsetTop, position.top);
                position.left = Math.max(0, position.left);

                // Prevent off-screen initial positioning (adjust if window shrunk)
                position.left = Math.min(position.left, window.innerWidth - draggable.offsetWidth + 10); // +10px buffer
                position.top = Math.min(position.top, window.innerHeight - draggable.offsetHeight + 10);

                draggable.style.top = `${position.top}px`;
                draggable.style.left = `${position.left}px`;
            } catch (e) {
                console.warn("setMoveable: Failed to parse stored position from localStorage.", e);
                _setDefaultPosition(); // Fallback to default
            }
        } else {
            _setDefaultPosition(); // Set default if no stored position
        }
    };

    // --- Set Default Position (centered or fixed initial) ---
    const _setDefaultPosition = () => {
        // If width/height are explicitly set, try to center it
        if (draggable.style.width && draggable.style.height) {
            draggable.style.left = `${(window.innerWidth - draggable.offsetWidth) / 2}px`;
            draggable.style.top = `${(window.innerHeight - draggable.offsetHeight) / 2}px`;
        } else {
            // Default to some fixed initial position if dimensions are not yet known
            draggable.style.left = `${(window.innerWidth - 720) / 2}px`; // Assuming default width 720px
            draggable.style.top = `${offsetTop + 80}px`; // Below offsetTop with a buffer
        }
    };

    // --- Save Position to localStorage ---
    const _savePosition = (x, y) => {
        const id = _getLocalStorageId();
        if (id) {
            const position = { top: y, left: x };
            localStorage.setItem(id, JSON.stringify(position));
        }
    };

    // --- Event Handlers ---

    const _handlePointerDown = (e) => {
        // Only start drag with primary mouse button (left click) or touch
        if (e.button === 0 || e.pointerType === 'touch') {
            e.stopPropagation();
            _isMouseDown = true;
            document.body.classList.add('no-select'); // Prevent text selection globally

            _initialPointerX = e.clientX;
            _initialPointerY = e.clientY;
            _initialDraggableX = draggable.offsetLeft;
            _initialDraggableY = draggable.offsetTop;

            // Bring to front (managed by Dialog's focus method if applicable)
            if (elementForClass && typeof elementForClass.focus === 'function') {
                elementForClass.focus();
            } else {
                draggable.style.zIndex = 1000; // Generic z-index for draggable if no custom focus
            }

            // Add global listeners for dragging
            document.addEventListener('pointermove', _handlePointerMove);
            document.addEventListener('pointerup', _handlePointerUp);
            // Optional: for mobile only, prevent default touch behavior (e.g. scrolling)
            if (e.pointerType === 'touch') {
                 handle.setPointerCapture(e.pointerId); // Capture pointer for consistent tracking
            }
        }
    };

    const _handlePointerMove = (e) => {
        e.stopPropagation();
        if (!_isMouseDown) return;

        // Calculate new position based on initial positions and pointer movement
        let newX = _initialDraggableX + (e.clientX - _initialPointerX);
        let newY = _initialDraggableY + (e.clientY - _initialPointerY);

        // Apply boundary constraints
        newX = Math.max(0, newX); // Left boundary
        newY = Math.max(offsetTop, newY); // Top boundary (considering offsetTop)

        // Right boundary
        const maxRight = window.innerWidth - draggable.offsetWidth;
        newX = Math.min(newX, maxRight);

        // Bottom boundary (considering handle height for reachability)
        const maxBottom = window.innerHeight - draggable.offsetHeight;
        newY = Math.min(newY, maxBottom);

        draggable.style.left = `${newX}px`;
        draggable.style.top = `${newY}px`;

        if (onmove) {
            onmove(newX, newY);
            // Dispatch a custom event from the draggable element
            draggable.dispatchEvent(
                new CustomEvent("moved", {
                    bubbles: true,
                    detail: { x: newX, y: newY },
                    composed: true
                })
            );
        }
    };

    const _handlePointerUp = (e) => {
        e.stopPropagation();
        _isMouseDown = false;
        document.body.classList.remove('no-select');

        _savePosition(draggable.offsetLeft, draggable.offsetTop); // Save final position

        // Release pointer capture for touch
        if (e.pointerType === 'touch') {
            handle.releasePointerCapture(e.pointerId);
        }

        // Remove global listeners
        document.removeEventListener('pointermove', _handlePointerMove);
        document.removeEventListener('pointerup', _handlePointerUp);
    };

    const _handleResize = () => {
        // Adjust position if window size causes it to go off-screen
        const currentLeft = draggable.offsetLeft;
        const currentTop = draggable.offsetTop;

        const newLeft = Math.min(currentLeft, window.innerWidth - draggable.offsetWidth - 10); // Keep 10px buffer
        const newTop = Math.min(currentTop, window.innerHeight - draggable.offsetHeight - 10); // Keep 10px buffer

        if (newLeft < 0) draggable.style.left = '0px';
        else if (newLeft !== currentLeft) draggable.style.left = `${newLeft}px`;

        if (newTop < offsetTop) draggable.style.top = `${offsetTop}px`;
        else if (newTop !== currentTop) draggable.style.top = `${newTop}px`;
    };

    // --- Initial Setup ---
    _restorePosition(); // Restore saved position on load

    // Add initial event listeners
    handle.addEventListener('pointerdown', _handlePointerDown);
    // Add resize listener to window to keep dialog in view
    window.addEventListener('resize', _handleResize);

    // Optional: Add a click listener on the handle to bring dialog to front (if not handled by pointerdown already)
    handle.addEventListener('click', (e) => {
        e.stopPropagation();
        if (elementForClass && typeof elementForClass.focus === 'function') {
            elementForClass.focus();
        } else {
            draggable.style.zIndex = 1000;
        }
    });
}