// Date: 2021-05-17
// Creator: Dave Courtois
// 
import { GetFileAudiosRequest, GetFileTitlesRequest, GetFileVideosRequest } from "globular-web-client/title/title_pb";
import { randomUUID } from "./utility";
import { Backend, displayError, displayMessage } from "../backend/backend";
import { FileExplorer } from "./fileExplorer/fileExplorer";
import { playVideo } from "./video";
import { playAudio } from "./audio";
import { FileController } from "../backend/file";

// Now I will test if imdb info are allready asscociated.
function getTitleInfo(globule, path, callback) {
    let rqst = new GetFileTitlesRequest
    rqst.setIndexpath(globule.config.DataPath + "/search/titles")

    rqst.setFilepath(path)

    globule.titleService.getFileTitles(rqst, { domain: globule.domain })
        .then(rsp => {
            callback(rsp.getTitles().getTitlesList())
        })
        .catch(err => {
            // so here no title was found...

            callback([])
        })
}

function getVideoInfo(globule, path, callback) {

    let rqst = new GetFileVideosRequest
    rqst.setIndexpath(globule.config.DataPath + "/search/videos")
    rqst.setFilepath(path)

    globule.titleService.getFileVideos(rqst, { domain: globule.domain })
        .then(rsp => {
            let videos = rsp.getVideos().getVideosList()
            callback(videos)
        })
        .catch(err => {
            callback([])
        })
}

function getAudioInfo(globule, path, callback) {

    let rqst = new GetFileAudiosRequest
    rqst.setIndexpath(globule.config.DataPath + "/search/audios")
    rqst.setFilepath(path)

    globule.titleService.getFileAudios(rqst, { domain: globule.domain })
        .then(rsp => {
            let audios = rsp.getAudios().getAudiosList()
            callback(audios)
        })
        .catch(err => {
            callback([])
        })
}

/**
 * Sample empty component
 */
export class Link extends HTMLElement {
    // attributes.

    // Create the applicaiton view.
    constructor(path, thumbnail, domain = Backend.domain, deleteable = false, alias = "") {
        super()
        // Set the shadow dom.
        this.attachShadow({ mode: 'open' });

        // reference to the file explorer.
        this._file_explorer_ = null;

        if (!path) {
            path = this.getAttribute("path")
        } else {
            this.setAttribute("path", path)
        }

        if (!thumbnail) {
            thumbnail = this.getAttribute("thumbnail")
        } else {
            this.setAttribute("thumbnail", thumbnail)
        }

        if (!domain) {
            domain = this.getAttribute("domain")
        } else {
            this.setAttribute("domain", domain)
        }

        if (alias != undefined) {
            this.setAttribute("alias", alias)
        } else if (this.hasAttribute("alias")) {
            alias = this.getAttribute("alias")
        }

        // get the deleteable attribute.
        if (deleteable == undefined) {
            deleteable = this.getAttribute("deleteable")
            if (deleteable) {
                if (deleteable.length == 0) {
                    deleteable = true
                } else {
                    deleteable = deleteable == "true"
                }
            }
        }


        let name = path.split("/")[path.split("/").length - 1]
        this.ondelete = null;
        let uuid = "_" + randomUUID()


        // Connect observer, so the attribute can be dynamic...
        var observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === "attributes") {
                    if (!mutation.target.hasAttribute("deleteable")) {
                        mutation.target.resetDeleteable()
                    } else {
                        mutation.target.setDeleteable()
                    }
                }
            });
        });

        observer.observe(this, {
            attributes: true //configure it to listen to attribute changes
        });

        // Innitialisation of the layout.
        this.shadowRoot.innerHTML = `
        <style>

            #container{
               
            }
            
            .shortcut-icon {
                position: absolute;
                bottom: -5px;
                left: 0px;
            }

            .shortcut-icon iron-icon{
                background: white;
                fill: black;
                height: 16px;
                width: 16px;
            }

            #content{
                position: relative;
                transition: background 0.2s ease,padding 0.8s linear;
                background-color: var(--palette-background-paper);
                display: flex; 
                flex-direction: column; 
                justify-content: center;
                border: 1px solid var(--palette-divider); 
                padding: 5px; 
                border-radius: 2.5px; 
            }

            #content:hover{
                cursor: pointer;
                -webkit-filter: invert(10%);
                filter: invert(10%);
            }

            img {
                max-height: 64px;
                object-fit: cover;
                max-width: 96px;
            }

            span{
                font-size: .85rem; 
                padding: 2px; 
                display: block; 
                word-break: break-all;
                max-width: 128px;
            }

            #delete-lnk-btn {
                height: 16px;
                width: 16px;
                flex-grow: 1; 
                --iron-icon-fill-color:var(--palette-text-primary);
            }

            .btn-div{
                position: relative;
                display: flex; 
                width: 24px; 
                height: 24px; 
                justify-content: center; 
                align-items: center;
                margin-bottom: 4px;
            }

            .btn-div:hover {
                cursor: pointer;
            }

        </style>

        <div id="${uuid}-link-div" style="margin: ${deleteable == true ? "25px" : "5px"} 10px 5px 10px; display: flex; flex-direction: column; align-items: center; width: fit-content; height: fit-content; position: relative;">
            <div style="position: absolute; top: -25px; left: -10px;">
                <div class="btn-div" style="visibility: hidden;">
                    <iron-icon  id="delete-lnk-btn"  icon="close"></iron-icon>
                    <paper-ripple class="circle"></paper-ripple>
                </div>
            </div>
            <div id="content">
                <img style="" src="${thumbnail}">
                <div class="shortcut-icon">
                    <iron-icon icon="icons:reply"></iron-icon>
                </div> 
                <paper-ripple></paper-ripple>
            </div>
            <span id="link-name">${alias.length > 0 ? alias : name}</span>
           
        </div>
        `

        this.uuid = uuid;

        let lnk = this.shadowRoot.querySelector(`#content`)
        lnk.onclick = () => {
            if (this._file_explorer_) {
                Backend.eventHub.publish("follow_link_event_", { path: path, domain: domain, _file_explorer_: this._file_explorer_ }, true)
            } else {

                FileController.getFile(Backend.globule, path, 64, 64, (file) => {
                    if (file.getIsDir()) {
                        let fileExplorer = new FileExplorer()
                        document.body.appendChild(fileExplorer)
                        this._file_explorer_ = fileExplorer
                     
                        fileExplorer.onclose = () => {
                            this._file_explorer_ = null
                        }

                        fileExplorer.onloaded = () => {
                            fileExplorer.publishSetDirEvent(path)
                        }

                    } else {
                        let mime = file.getMime()
                        if (mime.startsWith("video")) {
                            playVideo(file.getPath(), this.globule)
                        } else if (mime.startsWith("audio")) {
                            playAudio(file.getPath(), this.globule)
                        } else {
                            let fileExplorer = new FileExplorer()
                            document.body.appendChild(fileExplorer)
                            this._file_explorer_ = fileExplorer
                        
                            fileExplorer.onclose = () => {
                                this._file_explorer_ = null
                            }

                            fileExplorer.onloaded = () => {
                                fileExplorer.readFile(file)
                            }
                        }
                    }
                }, err => displayError(err, 3000), this.globule)
            }

        }

        lnk.draggable = true;
        this.shadowRoot.querySelector(`img`).draggable = false;

        lnk.ondragstart = (evt) => {
            // set the file path...
            let files = [path];

            evt.dataTransfer.setData('files', JSON.stringify(files));
            evt.dataTransfer.setData('id', uuid);
            evt.dataTransfer.setData('domain', domain);
        }

        lnk.ondragend = (evt) => {
            evt.stopPropagation();
        }

        // Here I will append the interation.
        lnk.onmouseover = (evt) => {
            evt.stopPropagation();
        }

        lnk.onmouseleave = (evt) => {
            evt.stopPropagation();
        }

        if (!deleteable && this.hasAttribute("deleteable")) {
            deleteable = true
        } else if (deleteable) {
            this.setAttribute("deleteable", "true")
            this.setDeleteable()
        } else {
            this.removeAttribute("deleteable")
            this.resetDeleteable()
        }

        this.shadowRoot.querySelector(".btn-div").onclick = (evt) => {
            evt.stopPropagation()

            if (document.getElementById(`${uuid}-yes-no-link-delete-box`)) {
                return
            }

            // Here I will ask the user for confirmation before actually delete the contact informations.
            let toast = displayMessage(
                `
            <style>
             
              #yes-no-link-delete-box{
                display: flex;
                flex-direction: column;
                justify-content: center;
              }

              #yes-no-link-delete-box globular-link-card{
                padding-bottom: 10px;
              }

              #yes-no-link-delete-box div{
                display: flex;
                padding-bottom: 10px;
              }

            </style>
            <div id="${uuid}-yes-no-link-delete-box">
              <div>Your about to delete link</div>
              <div style="display: flex; align-items; center; justify-content: center;">
                ${this.outerHTML}
              </div>
              <div>Is it what you want to do? </div>
              <div style="justify-content: flex-end;">
                <paper-button raised id="yes-delete-link">Yes</paper-button>
                <paper-button raised id="no-delete-link">No</paper-button>
              </div>
            </div>
            `,
                60000 // 1 min...
            );

            let yesNoDiv = toast.toastElement.querySelector(`#${uuid}-yes-no-link-delete-box`)
            let yesBtn = yesNoDiv.querySelector("#yes-delete-link")
            let noBtn = yesNoDiv.querySelector("#no-delete-link")
            yesNoDiv.querySelector("globular-link").removeAttribute("deleteable")

            // On yes
            yesBtn.onclick = () => {
                toast.hideToast();

                if (this.ondelete) {
                    this.ondelete()
                }

                this.parentNode.removeChild(this)
            }

            noBtn.onclick = () => {
                toast.hideToast();
            }

            toast.id = uuid
        }

        let globule = Backend.getGlobule(domain)
        getVideoInfo(globule, path,
            videos => {
                if (videos.length > 0) {
                    this.shadowRoot.querySelector("#link-name").innerHTML = videos[0].getDescription()
                }
            },
            err => {
                getTitleInfo(globule, path,
                    titles => {
                        if (titles.length > 0) {
                            this.shadowRoot.querySelector("#link-name").innerHTML = titles[0].getName()
                        }

                    },
                    err => {

                        getAudioInfo(globule, path,
                            audios => {
                                if (audios.length > 0) {
                                    this.shadowRoot.querySelector("#link-name").innerHTML = audios[0].getTitle()
                                }
                            }, err => { })
                    })
            })

    }

    connectedCallback() {
        if (this.hasAttribute("deleteable")) {
            this.setDeleteable()
        }
    }

    setDeleteable() {
        this.shadowRoot.querySelector(`#${this.uuid}-link-div`).style.marginTop = "25px"
        this.shadowRoot.querySelector(".btn-div").style.visibility = "visible";
    }

    resetDeleteable() {
        this.shadowRoot.querySelector(`#${this.uuid}-link-div`).style.marginTop = "5px"
        this.shadowRoot.querySelector(".btn-div").style.visibility = "hidden";
    }
}

customElements.define('globular-link', Link)