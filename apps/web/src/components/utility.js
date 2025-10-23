
import { AuthenticateRqst } from 'globular-web-client/authentication/authentication_pb';

export function fireResize() {
    if (document.createEvent) {
        // W3C
        var ev = document.createEvent('Event');
        ev.initEvent('resize', true, true);
        window.dispatchEvent(ev);
    } else {
        // IE
        var event = document.createEventObject();
        document.fireEvent("onresize", event);
    }
}

/**
 * Copies text to the clipboard.
 * @param text The text to copy.
 */
export function copyToClipboard(text) {
    const dummy = document.createElement("textarea");
    document.body.appendChild(dummy);
    dummy.value = text;
    dummy.select();
    document.execCommand("copy");
    document.body.removeChild(dummy);
}

export function mergeTypedArrays(a, b) {
    // Checks for truthy values on both arrays
    if (!a && !b) throw "Please specify valid arguments for parameters a and b.";

    // Checks for truthy values or empty arrays on each argument
    // to avoid the unnecessary construction of a new array and
    // the type comparison
    if (!b || b.length === 0) return a;
    if (!a || a.length === 0) return b;

    // Make sure that both typed arrays are of the same type
    if (Object.prototype.toString.call(a) !== Object.prototype.toString.call(b))
        throw "The types of the two arguments passed for parameters a and b do not match.";

    var c = new a.constructor(a.length + b.length);
    c.set(a);
    c.set(b, a.length);

    return c;
}

export function uint8arrayToStringMethod(uint8arr, callback) {
    var bb = new Blob([uint8arr]);
    var f = new FileReader();
    f.onload = function (e) {
        callback(e.target.result);
    };

    f.readAsText(bb);
}

/**
 * Format file size from bytes to Gb, Mb or Kb...
 * @param {*} f_size 
 * @returns 
 */
export function getFileSizeString(f_size) {

    // In case of already converted values...
    if (typeof f_size === 'string' || f_size instanceof String) {
        return f_size
    }

    let size = ""

    if (f_size > 1024) {
        if (f_size > 1024 * 1024) {
            if (f_size > 1024 * 1024 * 1024) {
                let fileSize = f_size / (1024 * 1024 * 1024);
                size = fileSize.toFixed(2) + " GB";
            } else {
                let fileSize = f_size / (1024 * 1024);
                size = fileSize.toFixed(2) + " MB";
            }
        } else {
            let fileSize = f_size / 1024;
            size = fileSize.toFixed(2) + " KB";
        }
    } else {
        size = f_size + " bytes";
    }

    return size
}

export function secondsToTime(secs) {
    var hours = Math.floor(secs / (60 * 60));

    var divisor_for_minutes = secs % (60 * 60);
    var minutes = Math.floor(divisor_for_minutes / 60);

    var divisor_for_seconds = divisor_for_minutes % 60;
    var seconds = Math.ceil(divisor_for_seconds);

    var obj = {
        "h": hours,
        "m": minutes,
        "s": seconds
    };
    return obj;
}

export function getCoords(elem) {
    // crossbrowser version
    var box = elem.getBoundingClientRect();
    var body = document.body;
    var docEl = document.documentElement;
    var scrollTop = window.pageYOffset || docEl.scrollTop || body.scrollTop;
    var scrollLeft = window.pageXOffset || docEl.scrollLeft || body.scrollLeft;
    var clientTop = docEl.clientTop || body.clientTop || 0;
    var clientLeft = docEl.clientLeft || body.clientLeft || 0;
    var top = box.top + scrollTop - clientTop;
    var left = box.left + scrollLeft - clientLeft;
    return {
        top: Math.round(top),
        left: Math.round(left)
    };
}

/**
 * Evaluates the color of the text to be used on a background color
 * @param {string} backgroundColor - The background color in hexadecimal format (e.g., "#RRGGBB")
 * @returns {string} - The color ("black" or "white") for better text visibility
 */
export function getTextColorForBackground(backgroundColor) {

    // Remove the '#' symbol if present
    if (backgroundColor.startsWith("rgba")) {
        backgroundColor = backgroundColor.replace(/[^\d,]/g, '').split(',');
        backgroundColor = rgbaToHex(parseInt(backgroundColor[0]), parseInt(backgroundColor[1]), parseInt(backgroundColor[2]), parseFloat(backgroundColor[3]));
    } else if (backgroundColor.startsWith("rgb")) {
        backgroundColor = backgroundColor.replace(/[^\d,]/g, '').split(',');
        backgroundColor = rgbToHex(parseInt(backgroundColor[0]), parseInt(backgroundColor[1]), parseInt(backgroundColor[2]));
    } else if (backgroundColor.startsWith("hsla")) {
        backgroundColor = backgroundColor.replace(/[^\d,]/g, '').split(',');
        backgroundColor = hslaToHex(parseInt(backgroundColor[0]), parseInt(backgroundColor[1]), parseInt(backgroundColor[2]), parseFloat(backgroundColor[3]));
    } else if (backgroundColor.startsWith("hsl")) {
        backgroundColor = backgroundColor.replace(/[^\d,]/g, '').split(',');
        backgroundColor = hslToHex(parseInt(backgroundColor[0]), parseInt(backgroundColor[1]), parseInt(backgroundColor[2]));
    } else {
        backgroundColor = namedColorToHex(backgroundColor);
    }

    if (backgroundColor.startsWith("#")) {
        backgroundColor = backgroundColor.slice(1);
    }
    // Convert the hexadecimal color to RGB components
    const red = parseInt(backgroundColor.substring(0, 2), 16);
    const green = parseInt(backgroundColor.substring(2, 4), 16);
    const blue = parseInt(backgroundColor.substring(4, 6), 16);

    // Calculate the relative luminance for the background color
    const L = 0.299 * red + 0.587 * green + 0.114 * blue;
    const brightness = L / 255;

    // Decide whether to use white or black text for better visibility
    return brightness > 0.5 ? "black" : "white";
}

/**
 * Gets the position of an element relative to the body
 * @param {HTMLElement} element - The element whose position is to be calculated
 * @returns {Object} - The position object with 'top' and 'left' properties
 */
export function getPositionRelativeToBody(element) {
    const rect = element.getBoundingClientRect();
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

    const position = {
        top: rect.top + scrollTop,
        left: rect.left + scrollLeft
    };

    return position;
}

/**
 * Converts RGB color values to a hexadecimal color string
 * @param {number} r - Red color value (0-255)
 * @param {number} g - Green color value (0-255)
 * @param {number} b - Blue color value (0-255)
 * @returns {string} - Hexadecimal color string (e.g., "#RRGGBB")
 */
export function rgbToHex(r, g, b) {
    const redHex = r.toString(16).padStart(2, '0');
    const greenHex = g.toString(16).padStart(2, '0');
    const blueHex = b.toString(16).padStart(2, '0');
    return `#${redHex}${greenHex}${blueHex}`;
}

export function rgbaToHex(r, g, b, a) {
    const hex = ((r << 16) | (g << 8) | b).toString(16);
    const alphaHex = Math.round(a * 255).toString(16).padStart(2, "0");
    return "#" + hex.padStart(6, "0") + alphaHex;
}

export function namedColorToHex(namedColor) {
    const element = document.createElement("div");
    element.style.color = namedColor;

    document.body.appendChild(element);
    const computedColor = getComputedStyle(element).color;

    document.body.removeChild(element);

    const rgbComponents = computedColor.match(/\d+/g);
    const hexColor = rgbToHex(parseInt(rgbComponents[0]), parseInt(rgbComponents[1]), parseInt(rgbComponents[2]));

    return hexColor;
}

/**
 * Gets the hexadecimal color of an element's text color
 * @param {HTMLElement} element - The element whose text color is to be retrieved
 * @returns {string} - Hexadecimal color string (e.g., "#RRGGBB")
 */
export function getHexColor(element) {
    const style = getComputedStyle(element);
    const rgbString = style.getPropertyValue('color');
    const rgbValues = rgbString.match(/\d+/g);
    const red = parseInt(rgbValues[0], 10);
    const green = parseInt(rgbValues[1], 10);
    const blue = parseInt(rgbValues[2], 10);

    return rgbToHex(red, green, blue);
}

function hslaToHex(h, s, l, a) {
    h = (h % 360 + 360) % 360; // Ensure h is within [0, 360)
    s = Math.max(0, Math.min(100, s)); // Clamp s within [0, 100]
    l = Math.max(0, Math.min(100, l)); // Clamp l within [0, 100]
    a = Math.max(0, Math.min(1, a)); // Clamp a within [0, 1]

    const hueToRgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };

    const q = l < 50 ? l * (1 + s / 100) : l + s - l * s / 100;
    const p = 2 * l - q;
    const r = Math.round(hueToRgb(p, q, h / 360 + 1 / 3) * 255);
    const g = Math.round(hueToRgb(p, q, h / 360) * 255);
    const b = Math.round(hueToRgb(p, q, h / 360 - 1 / 3) * 255);

    const alphaHex = Math.round(a * 255).toString(16).padStart(2, "0");

    return "#" + (1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1) + alphaHex;
}

export function hslToHex(h, s, l) {
    h = (h % 360 + 360) % 360; // Ensure h is within [0, 360)
    s = Math.max(0, Math.min(100, s)); // Clamp s within [0, 100]
    l = Math.max(0, Math.min(100, l)); // Clamp l within [0, 100]

    const hueToRgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };

    const q = l < 50 ? l * (1 + s / 100) : l + s - l * s / 100;
    const p = 2 * l - q;
    const r = Math.round(hueToRgb(p, q, h / 360 + 1 / 3) * 255);
    const g = Math.round(hueToRgb(p, q, h / 360) * 255);
    const b = Math.round(hueToRgb(p, q, h / 360 - 1 / 3) * 255);

    return "#" + (1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1);
}


/**
 * Gets the hexadecimal background color of an element
 * @param {HTMLElement} element - The element whose background color is to be retrieved
 * @returns {string} - Hexadecimal color string (e.g., "#RRGGBB")
 */
export function getHexBackgroundColor(element) {
    const style = getComputedStyle(element);
    const rgbString = style.getPropertyValue('background-color');
    const rgbValues = rgbString.match(/\d+/g);
    const red = parseInt(rgbValues[0], 10);
    const green = parseInt(rgbValues[1], 10);
    const blue = parseInt(rgbValues[2], 10);

    return rgbToHex(red, green, blue);
}

/**
 * Create a thumbnail from an url. The url can from from img.src...
 * @param {*} src The image url
 * @param {*} w The width of the thumnail
 * @param {*} callback The callback to be call
 */
export function createThumbmail(src, w, callback) {
    getImageFile(src, (img) => {
        if (img.width > w) {
            var oc = document.createElement('canvas'), octx = oc.getContext('2d');
            oc.width = img.width;
            oc.height = img.height;
            octx.drawImage(img, 0, 0);
            if (img.width > img.height) {
                oc.height = (img.height / img.width) * w;
                oc.width = w;
            } else {
                oc.width = (img.width / img.height) * w;
                oc.height = w;
            }
            octx.drawImage(oc, 0, 0, oc.width, oc.height);
            octx.drawImage(img, 0, 0, oc.width, oc.height);
            callback(oc.toDataURL());
        } else {
            callback(img.src);
        }

    })
}

export function createThumbmailFromImage(img, w, callback) {
    createThumbmail(img.src, w, callback)
}

export function formatDateTimeCustom(dateTime, format) {
    const year = dateTime.getFullYear();
    const month = String(dateTime.getMonth() + 1).padStart(2, '0'); // Adding 1 to month because it's zero-based
    const day = String(dateTime.getDate()).padStart(2, '0');
    const hours = String(dateTime.getHours()).padStart(2, '0');
    const minutes = String(dateTime.getMinutes()).padStart(2, '0');
    const seconds = String(dateTime.getSeconds()).padStart(2, '0');

    const formattedDateTime = format
        .replace('yyyy', year)
        .replace('mm', month)
        .replace('dd', day)
        .replace('hh', hours)
        .replace('mm', minutes)
        .replace('ss', seconds);

    return formattedDateTime;
}


// Authenticate the 'sa' user on the globule...
function authenticateSa(globule, password, callback, errorCallback) {
    let rqst = new AuthenticateRqst();
    rqst.setName('sa');
    rqst.setIssuer(globule.config.Mac)
    rqst.setPassword(password);

    globule.authenticationService.authenticate(rqst, {}).then((response) => {
        // Set the token
        globule.token = response.getToken();
        // Call the callback
        callback(response);
    }).catch((err) => {
            errorCallback(err);
        });
}

/**
 * Create a "version 4" RFC-4122 UUID (Universal Unique Identifier) string.
 * @returns {string} A string containing the UUID.
 */
export function randomUUID() {
    var s = [],
        itoh = '0123456789abcdef'; // Make array of random hex digits. The UUID only has 32 digits in it, but we
    // allocate an extra items to make room for the '-'s we'll be inserting.
  
    for (var i = 0; i < 36; i++) s[i] = Math.floor(Math.random() * 0x10); // Conform to RFC-4122, section 4.4
  
  
    s[14] = 4; // Set 4 high bits of time_high field to version
  
    s[19] = s[19] & 0x3 | 0x8; // Specify 2 high bits of clock sequence
    // Convert to hex chars
  
    for (var i = 0; i < 36; i++) s[i] = itoh[s[i]]; // Insert '-'s
  
  
    s[8] = s[13] = s[18] = s[23] = '-';
    return s.join('');
  }
  
  // extract the duration info from the raw data.
export function parseDuration(duration) {
    // display the track lenght...
    let obj = secondsToTime(duration)
    var hours = obj.h
    var min = obj.m
    var sec = obj.s
    let hours_ = (hours < 10) ? '0' + hours : hours;
    let minutes_ = (min < 10) ? '0' + min : min;
    let seconds_ = (sec < 10) ? '0' + sec : sec;

    if (hours > 0)
        return hours_ + ":" + minutes_ + ":" + seconds_;

    if (min > 0)
        return minutes_ + ":" + seconds_;

    return seconds_ + "'s";
}

export function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}


export function listToString(lst) {
    let str = "["
    if (lst) {
        lst.forEach((s, i) => {
            str += s;
            if (i < lst.length - 1) {
                str += " ,"
            }
        })
    }
    str += "]"

    return str
}


export function getBase64FromImageUrl(url) {
    return new Promise((resolve, reject) => {
        var img = new Image();
        img.setAttribute('crossOrigin', 'anonymous');

        img.onload = function () {
            var canvas = document.createElement("canvas");
            canvas.width = img.width;
            canvas.height = img.height;

            var ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0);

            var dataURL = canvas.toDataURL("image/png");

            resolve(dataURL);
        };

        img.onerror = function (error) {
            reject(error);
        };

        img.src = url;
    });
}
  