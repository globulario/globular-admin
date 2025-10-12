/*
ORIGINAL FILE CONTENT FOR REFERENCE:
import * as GlobularWebClient from "globular-web-client";
import { GeneratePeerTokenRequest, GeneratePeerTokenResponse, RefreshTokenRqst, RefreshTokenRsp } from "globular-web-client/authentication/authentication_pb";
import { Peer } from "globular-web-client/resource/resource_pb";
import { getAllPeersInfo } from "globular-web-client/api";
import * as Toastify from "toastify-js";
import { AccountController } from "./account";
import { FileInfo } from "globular-web-client/file/file_pb";
import "@polymer/paper-input/paper-input";
import '@polymer/paper-radio-button/paper-radio-button.js';
import '@polymer/paper-radio-group/paper-radio-group.js';


// Map to store generated tokens
let tokens: Record<string, string> = {};

/**
 * Returns the URL for the given globule.
 * @param globule - The globule object.
 * @returns The URL of the globule.
 *\/
export function getUrl(globule: GlobularWebClient.Globular = Backend.globular): string {
    let url = globule.config.Protocol + "://" + globule.config.Name + "." + globule.config.Domain;

    if (window.location.hostname !== globule.domain) {
        const hasMatchingPeer = globule.config.Peers.some(p => p.Domain === window.location.hostname);
        const isAlternateDomain = globule.config.AlternateDomains.includes(window.location.host);

        if (!hasMatchingPeer && isAlternateDomain) {
            url = globule.config.Protocol + "://" + window.location.host;
        }
    }

    if (globule.config.Protocol === "https") {
        if (globule.config.PortHttps !== 443) {
            url += ":" + globule.config.PortHttps;
        }
    } else {
        if (globule.config.PortHttp !== 80) {
            url += ":" + globule.config.PortHttp;
        }
    }

    return url;
}

export function displayMessage(msg: string, duration: number = 3000) {

    // Create a custom DOM element for the notification content
    // Create a container element with an error icon and text
    const msgContainer = document.createElement('div');
    msgContainer.innerHTML = `<span>${msg}</span>`;
    // Example notification with an error icon using the node option
    const msgNotification = Toastify({
        node: msgContainer, // Use the custom DOM element
        text: 'div',
        duration: duration,
        close: false,
        gravity: 'top',
        style: {
            background: 'var(--surface-color)',
            borderRadius: '.25rem',
            fontFamily: 'Roboto',
            fontSize: '1rem',
            color: 'var(--on-surface-color)',
        },
    });

    // Show the notification
    msgNotification.showToast();

    return msgNotification;
}

/**
 * Display an error message to the user
 * @param {*} err 
 *\/
export function displayError(err: any, duration: number = 3000) {

    // Create a custom DOM element for the notification content
    // Create a container element with an error icon and text
    const errorContainer = document.createElement('div');
    errorContainer.innerHTML = `
<i class="fa fa-exclamation-triangle" style="color: var(--error-color);"></i>
<span>${err}</span>
`;

    // Example notification with an error icon using the node option
    const errorNotification = Toastify({
        node: errorContainer, // Use the custom DOM element
        text: 'This is an error message!',
        duration: duration,
        close: true,
        gravity: 'top',
        style: {
            background: 'var(--surface-color)',
            borderRadius: '.25rem',
            fontFamily: 'Roboto',
            fontSize: '1.1rem',
            color: 'var(--on-surface-color)',
        },
    });

    // Show the notification
    errorNotification.showToast();
}

/**
 * Display a success message to the user
 * @param {*} msg 
 *\/
export function displaySuccess(msg: string, duration: number = 3000) {

    // Create a custom DOM element for the notification content
    // Create a container element with an error icon and text
    const msgContainer = document.createElement('div');
    msgContainer.innerHTML = `
<i class="fa fa-check-circle" style="color: var(--success-color);"></i>
<span>${msg}</span>
`;

    // Example notification with an error icon using the node option
    const successNotification = Toastify({
        node: msgContainer, // Use the custom DOM element
        text: 'This is an error message!',
        duration: duration,
        close: true,
        gravity: 'top',
        style: {
            background: 'var(--surface-color)',
            borderRadius: '.25rem',
            fontFamily: 'Roboto',
            fontSize: '1.1rem',
            color: 'var(--on-surface-color)',
        },
    });

    // Show the notification
    successNotification.showToast();
}


/**
 * 
 * @param msg The authentication message.
 * @param globule 
 * @param successCallback 
 * @param errorCallback 
 * @returns 
 *\/
export function displayAuthentication(msg: string, globule: GlobularWebClient.Globular, successCallback: (token:string) => void, errorCallback: (err: any) => void) {

    // Create a custom DOM element for the notification content
    // Create a container element with an error icon and text
    const container = document.createElement('div');
    container.innerHTML = `
    <div id="authentication-message" style="display: flex; flex-direction: column;">
        <div style="display: flex; align-items: center;">
            <i class="fa fa-exclamation-triangle" style="color: var(--error-color); margin-right: 5px;"></i>
            <span>${msg}</span>
        </div>
            <div>
            <paper-input
                label="username"
                type="text"
                id="user-input"
            >
                <iron-icon icon="user" slot="suffix" class="icon"></iron-icon>
            </paper-input>
            <paper-input
                label="Password"
                type="password"
                id="password-input"
            >
                <iron-icon icon="lock" slot="suffix" class="icon"></iron-icon>
            </paper-input>
        </div>
        <div style="display: flex; justify-content: end;">
            <paper-button --paper-button-flat style="font-size: .8rem; height: 24px;" id="sa-login-button" raised>Login</paper-button>
            <paper-button --paper-button-flat style="font-size: .8rem; height: 24px;" id="sa-cancel-button" raised>Cancel</paper-button>
        </div>
    </div>
    `;

    let autenticationMsg = <any>document.getElementById('authentication-message');

    // Check if the authentication message is already displayed
    if (autenticationMsg != null) {
        return;
    }


    // Example notification with an error icon using the node option
    const authentication = Toastify({
        node: container, // Use the custom DOM element
        close: false,
        duration: 0, // Set duration to 0 to prevent auto-hide
        gravity: 'top',
        style: {
            background: 'var(--surface-color)',
            borderRadius: '.25rem',
            fontFamily: 'Roboto',
            fontSize: '1.1rem',
            color: 'var(--on-surface-color)',
        },
    });


    // Show the notification
    authentication.showToast();

    // Focus on the password input
    autenticationMsg = document.getElementById('authentication-message');
    let userInput = autenticationMsg.querySelector('#user-input');
    userInput.value = localStorage.getItem("user_name") || "sa";
    let passwordInput = autenticationMsg.querySelector('#password-input');

    setTimeout(() => {
        userInput.focus();
    }, 100);

    // Add event listener to the password input
    passwordInput.addEventListener('keyup', (e: any) => {
        if (e.keyCode === 13) {
            // Cancel the event
            e.preventDefault();

            AccountController.authenticate(globule, userInput.value, passwordInput.value, (token: string) => {
                // Remove the authentication message
                authentication.hideToast();

                // Display the success message
                displaySuccess('Authentication successful!');

                // Call the success callback
                successCallback(token);
            }, (err) => {
                // Display the error message
                displayError(err);
            })
        }
    });

    // Add event listener to the login button
    let loginButton = autenticationMsg.querySelector('#sa-login-button');
    loginButton.addEventListener('click', (e: any) => {
        // Cancel the event
        e.preventDefault();

        // Here I will log the user...
        AccountController.authenticate(globule, userInput.value, passwordInput.value, (token: string) => {
            // Remove the authentication message
            authentication.hideToast();

            // Display the success message
            displaySuccess('Authentication successful!');

            // Call the success callback
            successCallback(token);
        }, (err) => {
            // Display the error message
            displayError(err);
        })

    });

    // Add event listener to the cancel button
    let cancelButton = autenticationMsg.querySelector('#sa-cancel-button');
    cancelButton.addEventListener('click', (e: any) => {
        // Cancel the event
        e.preventDefault();

        // Remove the authentication message
        authentication.hideToast();
    });

}

let refreshTimeout: any;

/**
 * Generates a peer token for the given globule, with automatic token refresh.
 * @param globule - The globule object.
 * @param callback - The success callback function.
 * @param errorCallback - The error callback function.
 *\/
export function generatePeerToken(
    globule: GlobularWebClient.Globular,
    callback: (token: string) => void,
    errorCallback: (err: any) => void
) {
    // Check if the provided globule is initialized
    if (!globule) {
        errorCallback("The globule was not initialized.");
        return;
    }

    const mac = globule.config.Mac;

    // Retrieve token from localStorage or use an empty string
    const storedToken = localStorage.getItem("user_token");
    const token = storedToken !== null ? storedToken : "";

    if (token === "") {
        displayAuthentication("Authentication required to access the resource.", globule, () => {
            generatePeerToken(globule, callback, errorCallback);
        }, errorCallback);
        return;
    }

    // Function to check if a JWT token is expired
    function isTokenExpired(token: string): boolean {
        try {
            const payload = JSON.parse(atob(token.split(".")[1]));
            const exp = payload.exp * 1000; // Convert to milliseconds
            return Date.now() >= exp;
        } catch (error) {
            return true; // If parsing fails, assume the token is invalid
        }
    }

    // Function to schedule token refresh before it expires
    function scheduleTokenRefresh(token: string) {
        try {
            const payload = JSON.parse(atob(token.split(".")[1]));
            const exp = payload.exp * 1000; // Expiration time in milliseconds
            const refreshTime = exp - Date.now() - 15000; // Refresh 15 seconds before expiration

            if (refreshTime > 0) {
                if (refreshTimeout) {
                    clearTimeout(refreshTimeout);
                }

                refreshTimeout = setTimeout(() => {
                    const rqst = new RefreshTokenRqst();
                    rqst.setToken(token);

                    if (!Backend.globular.authenticationService) {
                        errorCallback("The authentication service is not available.");
                        return;
                    }

                    Backend.globular.authenticationService
                        .refreshToken(rqst, { domain: Backend.globular.domain, token })
                        .then((rsp: RefreshTokenRsp) => {
                            const refreshedToken = rsp.getToken();
                            localStorage.setItem("user_token", refreshedToken);
                            scheduleTokenRefresh(refreshedToken); // Schedule next refresh
                        })
                        .catch((err) => {
                            console.error("Token refresh failed", err);
                        });
                }, refreshTime);
            }
        } catch (error) {
            console.error("Failed to schedule token refresh", error);
        }
    }

    // Refresh the token if it's expired
    if (isTokenExpired(token)) {
        // If the authentication service is not available, throw an error
        if (!Backend.globular.authenticationService) {
            errorCallback("The authentication service is not available.");
            return;
        }

        const rqst = new RefreshTokenRqst();
        rqst.setToken(token);

        Backend.globular.authenticationService
            .refreshToken(rqst, { domain: Backend.globular.domain, token })
            .then((rsp: RefreshTokenRsp) => {
                const refreshedToken = rsp.getToken();
                localStorage.setItem("user_token", refreshedToken);
                scheduleTokenRefresh(refreshedToken); // Schedule token refresh

                // Retry generating the peer token with the refreshed token
                generatePeerToken(globule, callback, errorCallback);
            })
            .catch(errorCallback);
        return;
    }

    // Schedule token refresh for the current token
    scheduleTokenRefresh(token);

    // If the application is running on the same globule and token is available, use it directly
    if (Backend.globular.config.Mac === mac && storedToken) {
        callback(token);
        return;
    }

    // If token is cached, use it
    if (tokens[mac]) {
        callback(tokens[mac]);
        return;
    }

    const request = new GeneratePeerTokenRequest();
    request.setMac(mac);

    // Check if the authentication service is available
    if (!Backend.globular.authenticationService) {
        errorCallback("The authentication service is not available.");
        return;
    }

    Backend.globular.authenticationService
        .generatePeerToken(request, { domain: Backend.globular.domain, token })
        .then((rsp: GeneratePeerTokenResponse) => {
            const generatedToken = rsp.getToken();
            tokens[mac] = generatedToken;

            // Remove the token before it becomes invalid
            setTimeout(() => {
                delete tokens[mac];
            }, (globule.config.SessionTimeout * 60 * 1000) - 15000);

            callback(generatedToken);
        })
        .catch(errorCallback);
}

export class Backend {

    private static globule: GlobularWebClient.Globular;

    /**
     * The domain of the application.
     *\/
    public static domain: string;

    /**
     * The address of the application.
     *\/
    public static address: string;



    /**
     * A map of connected globules, indexed by their addresses.
     *\/
    public static globules: Map<string, GlobularWebClient.Globular> = new Map<string, GlobularWebClient.Globular>();

    /**
     * Returns the globule associated with the given address.
     * @param address - The address of the desired globule.
     * @returns The globule with the provided address.
     *\/
    public static getGlobule(address: string): GlobularWebClient.Globular {
        if (address === "localhost" || address === "" || address == undefined) {
            return Backend.globular;
        }

        let globule = Backend.globules.get(address);
        if (globule) {
            return globule;
        }

        // No globule found, throw an error
        throw new Error("The globule with the address '" + address + "' was not found.");
    }

    /**
     * Returns an array of unique connected globules.
     * @returns An array of connected globules without duplicates.
     *\/
    public static getGlobules(): Array<GlobularWebClient.Globular> {
        const connections_ = Array.from(Backend.globules.values());
        const connections = new Array<GlobularWebClient.Globular>();

        // Remove duplicate connections based on config Name and Domain
        connections_.forEach(c => {
            const isDuplicate = connections.some(c_ => {
                return c.config.Name === c_.config.Name && c_.config.Domain === c_.config.Domain;
            });

            if (!isDuplicate) {
                connections.push(c);
            }
        });

        return connections;
    }

    /**
     * Returns the globule where the application is running.
     *\/
    public static get globular(): GlobularWebClient.Globular {
        return Backend.globule;
    }

    public static get eventHub(): GlobularWebClient.EventHub {
        return Backend.globule.eventHub;
    }

    // Pulish event on all globules...
    public static publish(name: string, data: any, local: boolean): void {
        let globules = Backend.getGlobules()
        globules.forEach(g => {
            g.eventHub.publish(name, data, local)
        })
    }

    // Subscribe to an event on all globules...
    public static subscribe(name: string, onSubscribe: (uuid: string) => void, onEvent: (data: any) => void, local: boolean): void {
        let globules = Backend.getGlobules()
        globules.forEach(g => {
            g.eventHub.subscribe(name, onSubscribe, onEvent, local)
        })
    }


    constructor() {
    }

    /**
     * Connect with the backend and get the initial configuration.
     * @param url The url of the backend
     * @param initCallback On success callback
     * @param errorCallback On error callback
     *\/
    static init(url: string, initCallback: () => void, errorCallback: (err: any) => void) {

        // If the url is not set, I will use the current url.
        Backend.globule = new GlobularWebClient.Globular(url, () => {


            Backend.eventHub.subscribe("start_peer_evt", uuid => { }, evt => {

                let obj = JSON.parse(evt)
                let peer = new Peer
                peer.setDomain(obj.domain)
                peer.setHostname(obj.hostname)
                peer.setMac(obj.mac)
                peer.setPorthttp(obj.portHttp)
                peer.setPorthttps(obj.portHttps)

                Backend.initPeer(peer, () => {
                    // dispatch the event locally...
                    Backend.eventHub.publish("start_peer_evt_", peer, true)
                }, err => console.log(err))

            }, false)

            Backend.eventHub.subscribe("stop_peer_evt", uuid => { }, evt => {

                let obj = JSON.parse(evt)
                let peer = new Peer
                peer.setDomain(obj.domain)
                peer.setHostname(obj.hostname)
                peer.setMac(obj.mac)
                peer.setPorthttp(obj.portHttp)
                peer.setPorthttps(obj.portHttps)

                // remove the peer from the map.
                Backend.removePeer(peer)

                // dispatch the event locally...
                Backend.eventHub.publish("stop_peer_evt_", peer, true)

            }, false)

            // If a new peers is connected...
            Backend.eventHub.subscribe("update_peers_evt", uuid => { },
                evt => {
                    let obj = JSON.parse(evt)
                    if (obj) {
                        let peer = new Peer
                        peer.setDomain(obj.domain)
                        peer.setHostname(obj.hostname)
                        peer.setMac(obj.mac)
                        peer.setPorthttp(obj.portHttp)
                        peer.setPorthttps(obj.portHttps)

                        let actions = new Array<string>()

                        if (obj.actions) {
                            obj.actions.forEach((a: string) => {
                                actions.push(a)
                            })
                        }

                        peer.setActionsList(actions)

                        Backend.initPeer(peer, () => {
                            // dispatch the event locally...
                            Backend.eventHub.publish("update_peers_evt_", peer, true)
                        }, err => console.log(err))

                    } else {
                        console.log("fail to parse ", evt)
                    }
                }, false)

            // So here I will create connection to peers know by globular...
            Backend.globules = new Map<string, GlobularWebClient.Globular>();
            Backend.domain = Backend.globular.config.Domain
            Backend.globules.set(Backend.domain, Backend.globular)
            Backend.address = Backend.globular.config.Name + "." + Backend.globular.config.Domain
            Backend.globules.set(Backend.address, Backend.globular)
            Backend.globules.set( Backend.globular.config.Name , Backend.globular)
            Backend.globules.set(Backend.globular.config.Protocol + "://" + Backend.address, Backend.globular)
            Backend.globules.set(Backend.address + ":" + Backend.globular.config.PortHttp, Backend.globular)
            Backend.globules.set(Backend.address + ":" + Backend.globular.config.PortHttps, Backend.globular)
            Backend.globules.set("http://" + Backend.address, Backend.globular)
            Backend.globules.set("https://" + Backend.address, Backend.globular)
            Backend.globules.set("http://" + Backend.address + ":" + Backend.globular.config.PortHttp, Backend.globular)
            Backend.globules.set("https://" + Backend.address + ":" + Backend.globular.config.PortHttps, Backend.globular)
            Backend.globules.set("http://" + Backend.domain, Backend.globular)
            Backend.globules.set("https://" + Backend.domain, Backend.globular)
            Backend.globules.set("http://" + Backend.domain + ":" + Backend.globular.config.PortHttp, Backend.globular)
            Backend.globules.set("https://" + Backend.domain + ":" + Backend.globular.config.PortHttps, Backend.globular)

            Backend.globules.set(Backend.globular.config.Mac, Backend.globular)

            if (Backend.globular.config.AlternateDomains == null) {
                Backend.globular.config.AlternateDomains = []
            }


            // I will also set the globule to other address...
            Backend.globular.config.AlternateDomains.forEach(alternateDomain => {
                // I will set alternate domain only if no peer has it domain.
                if (Backend.globular.config.Peers.filter((p) => { return p.Domain === alternateDomain; }).length == 0) {
                    Backend.globules.set(alternateDomain, Backend.globular)
                    let address = alternateDomain + ":" + window.location.port
                    if (address.endsWith(":")) {
                        if (Backend.globular.config.Protocol == "https") {
                            address += "443"
                        } else {
                            address += "80"
                        }
                    }
                    Backend.globules.set(address, Backend.globular)
                }
            });

            // Retreive peer's infos and register peers.
            getAllPeersInfo(Backend.globular, (peers: Peer[]) => {
                let index = 0;
                let connectToPeers = () => {
                    let peer = peers[index]
                    if (index < peers.length) {
                        index++
                        Backend.initPeer(peer, () => {
                            if (index < peers.length) {
                                connectToPeers()
                            } else {
                                initCallback();
                            }
                        },
                            err => {
                                console.log(err)
                                if (index < peers.length) {
                                    connectToPeers()
                                } else {
                                    initCallback();
                                }
                            })
                    } else {
                        initCallback();
                    }
                }

                // call onces
                connectToPeers()
            }, (err: any) => {
                initCallback();
            });
        }, err => { console.log(err); errorCallback(err); });

    }

    /**
     * Initialyse the peer.
     * @param peer The peer to initialyse
     * @param callback The success callback
     * @param errorCallback The error callback
     *\/
    static initPeer(peer: Peer, callback: () => void, errorCallback: (err: any) => void) {
        let port = 80
        if (Backend.globular.config.Protocol == "https") {
            port = 443
            if (peer.getProtocol() == "https") {
                port = peer.getPorthttps()
            }
        } else {
            port = peer.getPorthttps()
        }

        let url = peer.getProtocol() + "://" + peer.getHostname() + "." + peer.getDomain() + ":" + port + "/config"

        let globule = new GlobularWebClient.Globular(url, () => {

            // append the globule to the list.
            Backend.globules.set(peer.getProtocol() + "://" + peer.getHostname() + "." + peer.getDomain() + ":" + port, globule)
            Backend.globules.set(peer.getProtocol() + "://" + peer.getHostname() + "." + peer.getDomain(), globule)
            Backend.globules.set(url, globule)
            Backend.globules.set(peer.getHostname() + "." + peer.getDomain(), globule)
            Backend.globules.set(peer.getMac(), globule)

            callback()

        }, (err: any) => {
            console.log(err)
            errorCallback(err)
        })
    }

    /**
     * Remove the peer from the list of active globule.
     * @param peer 
     *\/
    static removePeer(peer: Peer) {
        let port = 80
        if (Backend.globular.config.Protocol == "https") {
            port = 443
            if (peer.getProtocol() == "https") {
                port = peer.getPorthttps()
            }
        } else {
            port = peer.getPorthttps()
        }

        let url = Backend.globular.config.Protocol + "://" + peer.getDomain() + ":" + port + "/config"

        // append the globule to the list.
        Backend.globules.delete(Backend.globular.config.Protocol + "://" + peer.getDomain() + ":" + port)
        Backend.globules.delete(url)
        Backend.globules.delete(peer.getDomain())
        Backend.globules.delete(peer.getMac())
    }

}
*/

export { setToken, getToken, metadata } from "backend/core/auth"
export { DEFAULT_BASE, serviceUrl } from "backend/core/endpoints"
