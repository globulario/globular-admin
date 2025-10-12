/*
ORIGINAL FILE CONTENT FOR REFERENCE:
import { Globular } from "globular-web-client"
import { GetTitleFilesRequest, Video, Audio, GetVideoByIdRequest, GetAudioByIdRequest, GetFileTitlesRequest, GetFileVideosRequest, GetFileAudiosRequest, GetTitleByIdRequest } from "globular-web-client/title/title_pb"
import { Backend, generatePeerToken, getUrl } from "./backend"
import { FileInfo } from "globular-web-client/file/file_pb";
import JwtDecode from "jwt-decode";
import { FindOneRqst } from "globular-web-client/persistence/persistence_pb";

// this is a hack to store the videos and audios in memory
let __videos__: { [key: string]: any } = {};
let __audios__: { [key: string]: any } = {};
let __titles__: { [key: string]: any } = {};


export class TitleController {

    static setVideo(video: Video) {
        __videos__[video.getId()] = video
    }

    static setTitle(title: any) {
        __titles__[title.getId()] = title
    }

    static setAudio(audio: Audio) {
        __audios__[audio.getId()] = audio
    }

    // That function will be use to asscociate file with imdb information.
    static getImdbInfo(id: string, callback: (title_id: string) => {}, errorcallback: (err: any) => void, globule: Globular = Backend.globular) {

        generatePeerToken(globule, token => {
            if (__titles__[id]) {
                if (__titles__[id].ID) {
                    callback(__titles__[id])
                } else {
                    __titles__[id].callbacks.push(callback)
                }
                return
            }

            __titles__[id] = {}
            __titles__[id].callbacks = []
            __titles__[id].callbacks.push(callback)

            let url = getUrl(globule)
            url += "/imdb_title?id=" + id
            url += "&domain=" + globule.domain
            url += "&token=" + token;

            var xmlhttp = new XMLHttpRequest();
            xmlhttp.timeout = 10 * 1000
            xmlhttp.onreadystatechange = function () {
                if (this.readyState == 4 && (this.status == 201 || this.status == 200)) {
                    var obj = JSON.parse(this.responseText);
                    while (__titles__[obj.ID].callbacks.length > 0) {
                        let callback = __titles__[obj.ID].callbacks.pop()
                        callback(obj)
                    }

                    __titles__[obj.ID] = obj
                    // Now I will 

                } else if (this.readyState == 4) {
                    errorcallback("fail to get info from query " + url + " status " + this.status)
                }
            };

            xmlhttp.open("GET", url, true);
            xmlhttp.setRequestHeader("domain", globule.domain);

            xmlhttp.send();
        }, errorcallback)
    }


    // get files associated with the titles, audios or videos...
    static getTitleFiles(id: string, indexPath: string, globule: Globular, callback: (files: string[]) => void, errorCallback: (err: any) => void) {
        let rqst = new GetTitleFilesRequest
        rqst.setTitleid(id)
        rqst.setIndexpath(indexPath)
        generatePeerToken(globule, token => {
            if (globule.titleService == null) return errorCallback("Title service is not available")

            // get the files associated with the title
            globule.titleService.getTitleFiles(rqst, { token: token })
                .then(rsp => {
                    callback(rsp.getFilepathsList())
                }).catch(err => {
                    callback([])
                })

        }, errorCallback)
    }

    /**
     * Retrieve the video information from the backend
     * @param globule The globule instance
     * @param id The video id
     * @param callback The success callback
     * @param errorCallback The error callback
     * @returns 
     *\/
    static getVideoInfo(id: string, callback: (video?: Video) => void, errorCallback: (err: any) => void, globule?: Globular) {

        // check if the video is already in memory
        if (__videos__[id]) {
            callback(__videos__[id])
            return
        }

        if (globule == null) return callback(undefined)

        // get the video information from the backend
        generatePeerToken(globule, token => {
            if (globule.titleService == null) return errorCallback("Title service is not available")

            let rqst = new GetVideoByIdRequest
            rqst.setIndexpath(globule.config.DataPath + "/search/videos")
            rqst.setVideoid(id)

            globule.titleService.getVideoById(rqst, { token: token })
                .then(rsp => {
                    let video = rsp.getVideo()
                    if (video == null) return callback(undefined)
                    callback(video)
                    __videos__[id] = video;
                    (video as any).globule = globule;
                })
                .catch(err => {
                    errorCallback(err)
                })
        }, errorCallback)
    }



    /**
     * Retrieve the audio information from the backend
     * @param globule The globule instance
     * @param id The audio id
     * @param callback The success callback
     * @param errorCallback The error callback
     * @returns 
     *\/
    static getAudioInfo(id: string, callback: (audio?: Audio) => void, errorCallback: (err: any) => void, globule: Globular = Backend.globular) {
        if (__audios__[id]) {
            callback(__audios__[id])
            return
        }

        if (globule == null) return callback(undefined)

        generatePeerToken(globule, token => {
            if (globule.titleService == null) return errorCallback("Title service is not available")

            let rqst = new GetAudioByIdRequest
            rqst.setIndexpath(globule.config.DataPath + "/search/audios")
            rqst.setAudioid(id)

            globule.titleService.getAudioById(rqst, { token: token })
                .then(rsp => {
                    let audio = rsp.getAudio()
                    if (audio == null) return callback(undefined)
                    __audios__[id] = audio;
                    (audio as any).globule = globule;
                    callback(audio)
                })
                .catch(err => {
                    console.log(err)
                    callback()
                })
        }, errorCallback)
    }

    static getFileTitlesInfo(file: FileInfo, callback: (titles?: any) => void, errorCallback: (err: any) => void, globule: Globular = Backend.globular) {
        if (__titles__[file.getPath()]) {
            callback(__titles__[file.getPath()])
            return
        }

        let rqst = new GetFileTitlesRequest
        rqst.setIndexpath(globule.config.DataPath + "/search/titles")
        rqst.setFilepath(file.getPath())


        generatePeerToken(globule, token => {
            if (globule.titleService == null) return errorCallback("Title service is not available")
            globule.titleService.getFileTitles(rqst, { domain: globule.domain, token: token })
                .then(rsp => {
                    if (rsp.getTitles() == null) return callback()
                    let titles = rsp.getTitles()
                    if (titles?.getTitlesList) {

                        if (titles.getTitlesList().length == 0) return errorCallback("No title found")
                        for (let t of titles.getTitlesList()) {
                            TitleController.setTitle(t);
                            (t as any).globule = globule;
                            (t as any).file = file;
                        }

                        (file as any).titles = titles.getTitlesList()

                        callback(titles.getTitlesList())
                    } else {
                        errorCallback("No title found")
                    }

                })
                .catch(err => {
                    // so here no title was found...
                    errorCallback(err)
                })
        }, errorCallback)
    }

    static getFileVideosInfo(file: FileInfo, callback: (titles?: any) => void, errorCallback: (err: any) => void, globule: Globular = Backend.globular) {

        let rqst = new GetFileVideosRequest
        rqst.setIndexpath(globule.config.DataPath + "/search/videos")
        rqst.setFilepath(file.getPath())
        generatePeerToken(globule, token => {
            if (globule.titleService == null) return errorCallback("Title service is not available")
            globule.titleService.getFileVideos(rqst, { domain: globule.domain, token: token })
                .then(rsp => {

                    if (rsp.getVideos() == null) return errorCallback("No video found")

                    let videos = rsp.getVideos()

                    if (videos?.getVideosList) {
                        if (videos.getVideosList().length == 0) return errorCallback("No video found")

                        videos.getVideosList()
                        for (let v of videos.getVideosList()) {
                            TitleController.setVideo(v);
                            (v as any).globule = globule;
                            (v as any).file = file;
                        }

                        (file as any).videos = videos.getVideosList()

                        callback(videos.getVideosList())
                    } else {
                        errorCallback("No video found")
                    }
                })
                .catch(err => {
                    errorCallback(err)
                })
        }, errorCallback)
    }

    static getFileAudiosInfo(file: FileInfo, callback: (audios?: any) => void, errorCallback: (err: any) => void, globule: Globular = Backend.globular) {

        let rqst = new GetFileAudiosRequest
        rqst.setIndexpath(globule.config.DataPath + "/search/audios")
        rqst.setFilepath(file.getPath())

        generatePeerToken(globule, token => {
            if (globule.titleService == null) return errorCallback("Title service is not available")

            globule.titleService.getFileAudios(rqst, { domain: globule.domain, token: token })
                .then(rsp => {
                    if (rsp.getAudios() == null) return errorCallback("No audio found")

                    let audios = rsp.getAudios()



                    if (audios?.getAudiosList) {
                        if (audios.getAudiosList().length == 0) return errorCallback("No audio found")

                        for (let a of audios.getAudiosList()) {
                            TitleController.setAudio(a);
                            (a as any).globule = globule;
                            (a as any).file = file;
                        }

                        callback(audios.getAudiosList())
                    } else {
                        errorCallback("No audio found")
                    }

                    callback(audios)
                })
                .catch(err => {
                    callback([])
                })
        }, errorCallback)
    }

    static getTitleInfo(id: string, callback: (title?: any) => void, errorCallback: (err: any) => void, globule: Globular = Backend.globular) {
        if (__titles__[id]) {
            callback(__titles__[id])
            return
        }

        // Read the json file and get the title infos...
        let rqst = new GetTitleByIdRequest
        rqst.setTitleid(id)
        rqst.setIndexpath(globule.config.DataPath + "/search/titles")

        generatePeerToken(globule, token => {
            if (globule.titleService == null) return errorCallback("Title service is not available")

            globule.titleService.getTitleById(rqst, { token: token }).then(rsp => {
                let title = rsp.getTitle()
                if (title == null) return callback(undefined)
                __titles__[id] = title;
                (title as any).globule = globule;
                callback(title)
            })

        }, errorCallback)

    }

    static getWacthingTitle(titleId: string, callback: (title: any) => void, errorCallback: (err: any) => void) {

        generatePeerToken(Backend.globular, (token) => {

            let decoded = JwtDecode(token);
            let userName = (decoded as any).username;
            let userDomain = (decoded as any).user_domain;
            const collection = "watching";

            // save the user_data
            let rqst = new FindOneRqst();
            let id = userName.split("@").join("_").split(".").join("_");
            let db = id + "_db";

            // set the connection infos,
            rqst.setId(id);
            rqst.setDatabase(db);
            rqst.setCollection(collection)
            rqst.setQuery(`{"_id":"${titleId}"}`)

            // So here I will set the address from the address found in the token and not 
            // the address of the client itself.
            let globule = Backend.getGlobule(userDomain)

            if (globule == null) return errorCallback("Globule is not available")

            if (globule.persistenceService == null) return errorCallback("Persistence service is not available")

            // call persist data
            globule.persistenceService
                .findOne(rqst, {
                    token: token,
                    domain: Backend.domain,
                })
                .then(rsp => {
       
                    let result = rsp.getResult()

                    // Here I will return the value with it
                    if(result == null) return errorCallback("No title found")

                    callback(result.toJavaScript())
                })
                .catch(err => {
                    errorCallback(err)
                });
        }, errorCallback)

    }


}
*/

export function setPageTitle(t: string) { document.title = t }
