/*
ORIGINAL FILE CONTENT FOR REFERENCE:
import { Globular } from "globular-web-client"
import { Backend, displayAuthentication, generatePeerToken, getUrl } from "./backend"
import { GetFileInfoRequest, ReadFileRequest, FileInfo, SaveFileRequest } from "globular-web-client/file/file_pb"
import { mergeTypedArrays, uint8arrayToStringMethod } from "../Utility"
import { readDir } from "globular-web-client/api"
import getUuidByString from "uuid-by-string"
import { AccountController } from "./account"

/**
 * Format file size from bytes to Gb, Mb or Kb...
 * @param {*} f_size 
 * @returns 
 *\/
export function getFileSizeString(f_size: any): string {

    // In case of already converted values...
    if (typeof f_size === 'string' || f_size instanceof String) {
        return (f_size as string)
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

// Return the size of a file at url.
export function getFileSize(url_: string, callback: (size: number) => void, errorcallback: (err: string) => void) {

    let url = window.location.protocol + "//" + window.location.host + "/file_size"

    var xmlhttp = new XMLHttpRequest();
    xmlhttp.timeout = 10 * 1000

    xmlhttp.onreadystatechange = function () {
        if (this.readyState == 4 && (this.status == 201 || this.status == 200)) {
            let obj = JSON.parse(this.responseText)
            callback(obj.size);
        } else if (this.readyState == 4) {
            errorcallback("fail to get the configuration file at url " + url + " status " + this.status)
        }
    };

    url += "?url=" + url_

    xmlhttp.open("GET", url, true);
    xmlhttp.setRequestHeader("domain", Backend.domain);

    xmlhttp.send();
}

export function copyToClipboard(text: string) {
    var dummy = document.createElement("textarea");
    // to avoid breaking orgain page when copying more words
    // cant copy when adding below this code
    // dummy.style.display = 'none'
    document.body.appendChild(dummy);
    //Be careful if you use texarea. setAttribute('value', value), which works with "input" does not work with "textarea". – Eduard
    dummy.value = text;
    dummy.select();
    document.execCommand("copy");
    document.body.removeChild(dummy);
}


export class FileController {

    // The list of directories that are currently open.
    private static _dirs_: any = [];

    // If the file does not really exist on the server It can be keep in that map.
    private static _local_files: any = {}

    // The list of public directories.
    private static _public_dirs_: any = []

    // The list of shared directories.
    private static _shared_dirs_: any = []


    // return the dirs property.
    static get dirs() {
        return FileController._dirs_;
    }

    // remove a dir from the list.
    static removeDir(path: string, globule: Globular = Backend.globular) {

        let key = getUuidByString(globule.domain + "@" + path)

        delete FileController._dirs_[key]
    }

    // add a dir to the list.
    static addDir(dir: FileInfo) {
        let key = getUuidByString(Backend.globular.domain + "@" + dir.getPath())
        FileController._dirs_[key] = dir
    }

    // return the public dirs property.
    static get publicDirs() {
        return FileController._public_dirs_;
    }


    // return the shared dirs property.
    static get sharedDirs() {
        return FileController._shared_dirs_;
    }

    static clearSharedDirs() {
        FileController._shared_dirs_ = {}
    }

    static hasLocal(path: string, callback: (exist: boolean, f?: FileInfo) => void) {
        let key = getUuidByString(Backend.globular.domain + "@" + path)
        let f = FileController._local_files[key]
        if (f != undefined) {
            callback(true, f)
            return
        }

        callback(false)
    }

    /**
     * Retrun the file from a given path.
     * @param globule 
     * @param path 
     * @param callback 
     * @param errorCallback 
     *\/
    static getFile(globule: Globular, path: string, thumbnailWith: number, thumbnailHeight: number, callback: (f: FileInfo) => void, errorCallback: (err: string) => void) {

        generatePeerToken(globule, token => {

            let rqst = new GetFileInfoRequest()
            rqst.setPath(path)
            rqst.setThumbnailheight(thumbnailHeight)
            rqst.setThumbnailwidth(thumbnailWith)
            const application = window.location.pathname.split('/')[1];


            if (!globule.fileService) {
                errorCallback("File service not initialized.")
                return
            }

            globule.fileService.getFileInfo(rqst, { token: token, application: application, domain: globule.domain })
                .then(rsp => {
                    let f = rsp.getInfo()
                    if (f == null) {
                        errorCallback("File not found.")
                        return
                    }

                    (f as any).globule = globule;

                    callback(f);
                })
                .catch(e => {

                    errorCallback(e.message || e)
                })
        }, errorCallback)
    }


    // so here I will initialyse lnk's in that directory
    static initLnks(dir: FileInfo, callback: (dir: FileInfo) => void, errorCallback: (err: any) => void) {

        // callback(dir)
        let initLink_ = (index: number) => {
            if (index == dir.getFilesList().length) {
                callback(dir)
                return
            }

            let f = dir.getFilesList()[index]
            index += 1
            if (!f.getIsDir() && f.getName().endsWith(".lnk")) {

                FileController.readText(f,
                    txt => {

                        let lnk = FileInfo.deserializeBinary(txt as Uint8Array)
                        f = lnk // I will replace the file by the lnk file...

                        initLink_(index)
                    },
                    () => {
                        initLink_(index)
                    })

            } else {
                initLink_(index)
            }
        }

        let index = 0;
        initLink_(index)
    }


    static markAsShare(dir: FileInfo) {
        FileController._shared_dirs_[dir.getPath()] = {};
        dir.getFilesList().forEach(f => {
            if (f.getIsDir()) {
                FileController.markAsShare(f)
            }
        })
    }

    static markAsPublic(dir: FileInfo) {
        FileController._public_dirs_[dir.getPath()] = {};

        dir.getFilesList().forEach(f => {
            if (f.getIsDir()) {
                FileController.markAsPublic(f)
            }
        })
    }

    static readDir(path: string, callback: (dir: FileInfo) => void, errorCallback: (err: any) => void, globule: Globular = Backend.globular, force: boolean = false, recursive = false) {
        // replace separator...
        path = path.split("\\").join("/")
        let key = getUuidByString(globule.domain + "@" + path)
        if (!force || path == "/public" || path == "/shared") {
            let dir = FileController._dirs_[key]
            if (dir != null) {
                if (dir.getFilesList().length > 0) {
                    callback(FileController._dirs_[key])
                    return
                }
            }
        }

        // Here I will keep the dir info in the cache...
        FileController._readDir(path, recursive, (dir) => {

            FileController.initLnks(dir, dir => {
                callback(dir)
            }, errorCallback)

            // replace separator...
            let path = dir.getPath().split("\\").join("/")
            let parent = path.substring(0, path.lastIndexOf("/"))

            if (FileController._public_dirs_[parent]) {
                FileController.markAsPublic(dir)
            }

        }, errorCallback, globule, true)

    }

    /**
     * Static function's
     *\/
    private static _readDir(path: string, recursive: boolean, callback: (dir: FileInfo) => void, errorCallback: (err: any) => void, globule: Globular = Backend.globular, force: boolean = false) {

        // So here I will get the dir of the current user...
        generatePeerToken(globule, token => {

            // The globule must be defined.
            if (!globule) {
                throw "Globule not defined."
            }

            path = path.replace(globule.config.DataPath + "/files/", "/")

            let id = globule.domain + "@" + path
            let key = getUuidByString(id)

            if (FileController._local_files[key] != undefined && !force) {
                callback(FileController._local_files[key])
                return
            }

            readDir(globule, path, recursive, (dir: FileInfo) => {
                if (!globule) {
                    globule = Backend.globular
                }

                // Here I will keep the dir info in the cache...
                FileController._local_files[key] = dir;
                (dir as any).globule = globule

                // I will also set the globule for each file in the dir...
                dir.getFilesList().forEach(f => {
                    (f as any).globule = globule
                    let path = f.getPath()
                    path = path.replace(globule.config.DataPath + "/files/", "/")

                    let id = globule.domain + "@" + path
                    let key = getUuidByString(id)
                    FileController._local_files[key] = f;
                })

                callback(dir)
            }, err => {
                // In case of error I will check if the token is expired...
                if (err.message == "the token is expired") {
                    // In that case I will ask for login again...
                    displayAuthentication("Authentication required to access the resource.", globule, () => {
                        // Here I will try to read the dir again...
                        FileController._readDir(path, recursive, callback, errorCallback, globule, force)

                    }, errorCallback);
                } else {
                    errorCallback(err)
                }
            }, () => { }, 80, 80, token)
        }, errorCallback)
    }


    static validateDirAccess(dir: FileInfo): boolean {
        let public_ = FileController.publicDirs
        let shared = FileController.sharedDirs


        dir.setPath(dir.getPath().split("\\").join("/"))
        if (!(dir.getPath().startsWith("/public") || public_[dir.getPath()] != undefined || dir.getPath().startsWith("/shared") || shared[dir.getPath()] != undefined || dir.getPath().startsWith("/users/" + AccountController.account.getId()))) {
            return true;
        }


        return true;
    }

    // Modify readText to use async behavior.
    static async fetchText(path:string, globule = Backend.globular) {
        return new Promise((resolve, reject) => {
            generatePeerToken(
                globule,
                (token) => {
                    const rqst = new ReadFileRequest();
                    rqst.setPath(path);
                    let data:any = [];

                    if (!globule.fileService) {
                        reject("File service not initialized.");
                        return;
                    }

                    const stream = globule.fileService.readFile(rqst, {
                        domain: globule.domain,
                        token: token,
                    });

                    stream.on("data", (rsp) => {
                        data = mergeTypedArrays(data, rsp.getData());
                    });

                    stream.on("status", (status) => {
                        if (status.code === 0) {
                            uint8arrayToStringMethod(data, (str) => resolve(str));
                        } else {
                            reject(status.details);
                        }
                    });
                },
                (err) => {
                    reject(err);
                }
            );
        });
    }


    static readText(file: FileInfo, callback: (text: Uint8Array | string) => void, errorCallback: (err: any) => void, globule: Globular = Backend.globular, token: string = localStorage.getItem("user_token")||"") {
        // Read the file...
        let url = getUrl(globule)

        file.getPath().split("/").forEach(item => {
            url += "/" + encodeURIComponent(item.trim())
        })

        if (!globule) {
            globule = Backend.globular
        }

        // Generate peer token.

        let rqst = new ReadFileRequest
        rqst.setPath(file.getPath())
        let data: any = []

        // do nothing if no file service was initialized.
        if (!globule.fileService) {
            errorCallback("File service not initialized.")
            return
        }

        let stream = globule.fileService.readFile(rqst, { domain: globule.domain, token: token })
        // Here I will create a local event to be catch by the file uploader...
        stream.on("data", (rsp) => {
            data = mergeTypedArrays(data, rsp.getData());
        })

        stream.on("status", (status) => {
            if (status.code == 0) {
                uint8arrayToStringMethod(data, (str) => {
                    callback(str);
                });
            } else {
                // In case of error I will return an empty array
                errorCallback(status.details)
            }
        });
    }

    static getHiddenFiles(path: string, callback: (files: any) => void, globule: Globular = Backend.globular) {

        let thumbnailPath = path.replace("/playlist.m3u8", "")
        if (thumbnailPath.lastIndexOf(".mp3") != -1 || thumbnailPath.lastIndexOf(".mp4") != -1 || thumbnailPath.lastIndexOf(".mkv") != -1 || thumbnailPath.lastIndexOf(".avi") != -1 || thumbnailPath.lastIndexOf(".MP4") != -1 || thumbnailPath.lastIndexOf(".MKV") != -1 || thumbnailPath.lastIndexOf(".AVI") != -1) {
            thumbnailPath = thumbnailPath.substring(0, thumbnailPath.lastIndexOf("."))
        }

        thumbnailPath = thumbnailPath.substring(0, thumbnailPath.lastIndexOf("/") + 1) + ".hidden" + thumbnailPath.substring(thumbnailPath.lastIndexOf("/")) + "/__preview__"

        FileController.readDir(thumbnailPath, callback, err => { console.log(err); callback(null); }, globule)
    }

    static getImage(callback: ([]) => void, images: any, files: FileInfo[], index: number, globule: Globular = Backend.globular) {
        let f = files[index];
        index++

        // set the url for the image.
        let url = ""

        // Get image from the globule.
        url = globule.config.Protocol + "://" + globule.address
        if (globule.config.Protocol == "https") {
            if (globule.config.PortHttps != 443)
                url += ":" + globule.config.PortHttps
        } else {
            if (globule.config.PortHttps != 80)
                url += ":" + globule.config.PortHttp
        }


        if (f == undefined) {
            callback([])
            return
        }

        if (!f.getPath()) {
            callback([])
            return
        }

        let path = f.getPath().split("/")
        path.forEach(item => {
            item = item.trim()
            if (item.length > 0)
                url += "/" + encodeURIComponent(item)
        })

        generatePeerToken(globule, token => {
            // Set url query parameter.
            url += "?domain=" + globule.domain
            url += "&token=" + token

            var xhr = new XMLHttpRequest();
            xhr.timeout = 10 * 1000
            xhr.open('GET', url, true);
            xhr.setRequestHeader("token", token);
            xhr.setRequestHeader("domain", globule.domain);

            // Set responseType to 'arraybuffer', we want raw binary data buffer
            xhr.responseType = 'blob';

            xhr.onload = (rsp) => {
                const xhr = rsp.currentTarget as XMLHttpRequest; // Cast to XMLHttpRequest

                if (xhr.status === 200) {
                    const reader = new FileReader();
                    reader.readAsDataURL(xhr.response as Blob); // Ensure `response` is treated as Blob
                    reader.onload = (e: ProgressEvent<FileReader>) => {
                        const result = e.target?.result; // Safely access `result`
                        if (result) {
                            const img = document.createElement("img");
                            img.src = result.toString(); // Convert `result` to string for the `src` property
                            images.push(img);

                            if (index < files.length) {
                                FileController.getImage(callback, images, files, index, globule); // Recursive call
                            } else if (callback) {
                                callback(images);
                            }
                        }
                    };
                }
            };

            xhr.send();
        }, err => { console.log(err) })
    }

}
*/

import { unary, stream } from "../core/rpc"
const SERVICE = "file.FileService"
const factory = (addr: string) => new (window as any).FileServiceClient?.(addr)

// export async function readDir(path: string, recursive = false) { ... }
// export async function readFile(path: string, onChunk: (b: Uint8Array) => void) { ... }
// export async function saveFile(path: string, data: Uint8Array) { ... }
