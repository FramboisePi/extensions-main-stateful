import {
  Source,
  Manga,
  Chapter,
  ChapterDetails,
  HomeSection,
  SearchRequest,
  MangaStatus,
  MangaUpdates,
  PagedResults,
  FormObject,
  SourceInfo,
  TagSection,
  UserForm,
  MangaTile,
  SourceMenu,
  SourceMenuItemType,
  TagType,
  ContentRating,
  RequestInterceptor,
  Request,
  Response
} from "paperback-extensions-common"

import {reverseLangCode} from "./Languages"

export const KomgaInfo: SourceInfo = {
  version: "1.1.3",
  name: "Komga",
  icon: "icon.png",
  author: "Lemon",
  authorWebsite: "https://github.com/FramboisePi",
  description: "Extension that pulls manga from a Komga server",
  //language: ,
  contentRating: ContentRating.EVERYONE,
  websiteBaseURL: "https://komga.org",
  sourceTags: [
    {
        text: "Self hosted",
        type: TagType.RED
    }
]
}

const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"]

// Number of items requested for paged requests
const PAGE_SIZE = 40

export const parseMangaStatus = (komgaStatus: string) => {
  switch (komgaStatus) {
    case "ENDED":
      return MangaStatus.COMPLETED
    case "ONGOING":
      return MangaStatus.ONGOING
    case "ABANDONED":
      return MangaStatus.ONGOING
    case "HIATUS":
      return MangaStatus.ONGOING
  }
  return MangaStatus.ONGOING
}


export class KomgaRequestInterceptor implements RequestInterceptor {
  stateManager = createSourceStateManager({})

  async getAuthorizationString(): Promise<string>{    
    const authorizationString = await this.stateManager.retrieve("authorization")

    if (authorizationString === null) {
      throw new Error("Unset credentials in source settings")
    }
    return authorizationString
  }


  async interceptResponse(response: Response): Promise<Response> {
    return response
  }

  async interceptRequest(request: Request): Promise<Request> {

    if (request.headers === undefined) {
      request.headers = {}
    }

    // We mustn't call this.getAuthorizationString() for the stateful submission request.
    // This procedure indeed catchs the request used to check user credentials
    // which can happen before an authorizationString is saved,
    // raising an error in getAuthorizationString when we check for its existence
    // Thus we only inject an authorizationString if none are defined in the request
    if (request.headers.authorization === undefined) {
      request.headers.authorization = await this.getAuthorizationString()
    }
    
    return request
  }
}


export class Komga extends Source {

  createAuthorizationString(username: String, password: String) {
    return "Basic " + Buffer.from(username + ":" + password, 'binary').toString('base64')
  }
  createKomgaAPI(serverAddress: String){
    return serverAddress + (serverAddress.slice(-1) === "/" ? "api/v1" : "/api/v1")
  }

  async getAuthorizationString(): Promise<string>{
    const authorizationString = await this.stateManager.retrieve("authorization")

    if (authorizationString === null) {
      throw new Error("Unset credentials in source settings")
    }
    return authorizationString
  }

  async getKomgaAPI(): Promise<string>{
    const komgaAPI = await this.stateManager.retrieve("komgaAPI")

    if (komgaAPI === null) {
      throw new Error("Unset server URL in source settings")
    }
    return komgaAPI
  }

  stateManager = createSourceStateManager({})

  requestManager = createRequestManager({
    requestsPerSecond: 4,
    interceptor: new KomgaRequestInterceptor()
  })

  async getMangaDetails(mangaId: string): Promise<Manga> {
    /*
      In Komga a manga is represented by a `serie`
     */
    const komgaAPI = await this.getKomgaAPI()

    const request = createRequestObject({
      url: `${komgaAPI}/series/${mangaId}/`,
      method: "GET",
    })

    const response = await this.requestManager.schedule(request, 1)
    const result = typeof response.data === "string" ? JSON.parse(response.data) : response.data
    const metadata = result.metadata
    const booksMetadata = result.booksMetadata

    const tagSections: TagSection[] = [createTagSection({ id: '0', label: 'genres', tags: [] }),
                                       createTagSection({ id: '1', label: 'tags', tags: [] })]
    tagSections[0].tags = metadata.genres.map((elem: string) => createTag({ id: elem, label: elem }))
    tagSections[1].tags = metadata.tags.map((elem: string) => createTag({ id: elem, label: elem }))

    let authors: string[] = []
    let artists: string[] = []

    // Additional roles: colorist, inker, letterer, cover, editor
    for (let entry of booksMetadata.authors) {
      if (entry.role === "writer") {
        authors.push(entry.name)
      }
      if (entry.role === "penciller") {
        artists.push(entry.name)
      }
    }

    return createManga({
      id: mangaId,
      titles: [metadata.title],
      image: `${komgaAPI}/series/${mangaId}/thumbnail`,
      rating: 5,
      status: parseMangaStatus(metadata.status),
      langFlag: metadata.language,
      //langName:,
      
      artist: artists.join(", "),
      author: authors.join(", "),

      desc: (metadata.summary ? metadata.summary : booksMetadata.summary),
      tags: tagSections,
      lastUpdate: metadata.lastModified
    })
}


  async getChapters(mangaId: string): Promise<Chapter[]> {
    /*
      In Komga a chapter is a `book`
     */

    const komgaAPI = await this.getKomgaAPI()

    const request = createRequestObject({
      url: `${komgaAPI}/series/${mangaId}/books`,
      param: "?unpaged=true&media_status=READY",
      method: "GET",
    })

    const response = await this.requestManager.schedule(request, 1)
    const result = typeof response.data === "string" ? JSON.parse(response.data) : response.data
    
    let chapters: Chapter[] = []

    // Chapters language is only available on the serie page
    const requestSerie = createRequestObject({
      url: `${komgaAPI}/series/${mangaId}/`,
      method: "GET",
    })
    const responseSerie = await this.requestManager.schedule(requestSerie, 1)
    const resultSerie = typeof responseSerie.data === "string" ? JSON.parse(responseSerie.data) : responseSerie.data
    const languageCode = reverseLangCode[resultSerie.metadata.language] ?? reverseLangCode['_unknown']

    for (let book of result.content) {
      chapters.push(
        createChapter({
          id: book.id,
          mangaId: mangaId,
          chapNum: book.metadata.numberSort,
          langCode: languageCode,
          name: `${book.metadata.number} - ${book.metadata.title} (${book.size})`,          
          time: new Date(book.fileLastModified),
        })
      )
    }

    return chapters
  }

  async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {

    const komgaAPI = await this.getKomgaAPI()

    const request = createRequestObject({
      url: `${komgaAPI}/books/${chapterId}/pages`,
      method: "GET",
    })

    const data = await this.requestManager.schedule(request, 1)
    const result = typeof data.data === "string" ? JSON.parse(data.data) : data.data
    
    
    let pages: string[] = []
    for (let page of result) {
      if (SUPPORTED_IMAGE_TYPES.includes(page.mediaType)) {
        pages.push(`${komgaAPI}/books/${chapterId}/pages/${page.number}`)
      } else {
        pages.push(`${komgaAPI}/books/${chapterId}/pages/${page.number}?convert=png`)
      }
    }
    
    // Determine the preferred reading direction which is only available in the serie metadata
    const serieRequest = createRequestObject({
      url: `${komgaAPI}/series/${mangaId}/`,
      method: "GET",
    })

    const serieResponse = await this.requestManager.schedule(serieRequest, 1)
    const serieResult = typeof serieResponse.data === "string" ? JSON.parse(serieResponse.data) : serieResponse.data

    let longStrip = false
    if (["VERTICAL", "WEBTOON"].includes(serieResult.metadata.readingDirection)) {
      longStrip = true
    }

    return createChapterDetails({
      id: chapterId,
      longStrip: longStrip,
      mangaId: mangaId,
      pages: pages,
    })
  }


  async searchRequest(searchQuery: SearchRequest, metadata: any): Promise<PagedResults> {

    const komgaAPI = await this.getKomgaAPI()
    let page : number = metadata?.page ?? 0

    let paramsList = [`page=${page}`, `size=${PAGE_SIZE}`]

    if (searchQuery.title !== undefined) {
      paramsList.push("search=" + encodeURIComponent(searchQuery.title))
    }
    /*
    if (query.status !== undefined) {
      paramsList.push("status=" + KOMGA_STATUS_LIST[query.status])
    }
    */

    let paramsString = ""
    if (paramsList.length > 0) {
      paramsString = "?" + paramsList.join("&");
    }

    const request = createRequestObject({
      url: `${komgaAPI}/series`,
      method: "GET",
      param: paramsString,
    })

    const data = await this.requestManager.schedule(request, 1)

    const result = typeof data.data === "string" ? JSON.parse(data.data) : data.data

    let tiles = []
    for (let serie of result.content) {
      tiles.push(createMangaTile({
        id: serie.id,
        title: createIconText({ text: serie.metadata.title }),
        image: `${komgaAPI}/series/${serie.id}/thumbnail`,
        subtitleText: createIconText({ text: "id: " + serie.id }),
      }))
    }

    // If no series were returned we are on the last page
    metadata = tiles.length === 0 ? undefined : {page: page + 1}

    return createPagedResults({
      results: tiles,
      metadata
    })
  }

  async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {


    // We won't use `await this.getKomgaAPI()` as we do not want to throw an error on
    // the homepage when settings are not set
    const komgaAPI = await this.stateManager.retrieve("komgaAPI")

    if (komgaAPI === null) {
      // Server unset in source settings
      const section = createHomeSection({
        id: 'unset',
        title: 'Server unset in source settings',
        view_more: false,
      })
      sectionCallback(section)
      return
    }

    // The source define two homepage sections: new and latest
    const sections = [
      createHomeSection({
        id: 'new',
        title: 'Recently added series',
        view_more: true,
      }),
      createHomeSection({
        id: 'updated',
        title: 'Recently updated series',
        view_more: true,
      }),
    ]

    const promises: Promise<void>[] = []

    for (const section of sections) {
      // Let the app load empty tagSections
      sectionCallback(section)

      const request = createRequestObject({
        url: `${komgaAPI}/series/${section.id}`,
        param: "?page=0&size=20",
        method: "GET",
      })

      // Get the section data
      promises.push(
          this.requestManager.schedule(request, 1).then(data => {
            let result = typeof data.data === "string" ? JSON.parse(data.data) : data.data

            let tiles = []
            for (let serie of result.content) {
              tiles.push(createMangaTile({
                id: serie.id,
                title: createIconText({ text: serie.metadata.title }),
                image: `${komgaAPI}/series/${serie.id}/thumbnail`,
                subtitleText: createIconText({ text: "id: " + serie.id }),
              }))
            }
            section.items = tiles
            sectionCallback(section)
          }),
      )
    }

    // Make sure the function completes
    await Promise.all(promises)
  }

  async getViewMoreItems(homepageSectionId: string, metadata: any): Promise<PagedResults> {

    const komgaAPI = await this.getKomgaAPI()
    let page: number = metadata?.page ?? 0

    const request = createRequestObject({
      url: `${komgaAPI}/series/${homepageSectionId}`,
      param: `?page=${page}&size=${PAGE_SIZE}`,
      method: "GET",
    })

    const data = await this.requestManager.schedule(request, 1)
    const result = typeof data.data === "string" ? JSON.parse(data.data) : data.data

    let tiles: MangaTile[] = []
    for (let serie of result.content) {
      tiles.push(createMangaTile({
        id: serie.id,
        title: createIconText({ text: serie.metadata.title }),
        image: `${komgaAPI}/series/${serie.id}/thumbnail`,
        subtitleText: createIconText({ text: "id: " + serie.id }),
      }))
    }

    // If no series were returned we are on the last page
    metadata = tiles.length === 0 ? undefined : {page: page + 1}
    
    return createPagedResults({
        results: tiles,
        metadata: metadata
    })
  }

  async filterUpdatedManga(mangaUpdatesFoundCallback: (updates: MangaUpdates) => void, time: Date, ids: string[]): Promise<void> {

    const komgaAPI = await this.getKomgaAPI()

    // We make requests of PAGE_SIZE titles to `series/updated/` until we got every titles 
    // or we got a title which `lastModified` metadata is older than `time`
    let page = 0
    let foundIds: string[] = []
    let loadMore = true

    while (loadMore) {

      const request = createRequestObject({
        url: `${komgaAPI}/series/updated/`,
        param: `?page=${page}&size=${PAGE_SIZE}`,
        method: "GET",
      })

      const data = await this.requestManager.schedule(request, 1)
      let result = typeof data.data === "string" ? JSON.parse(data.data) : data.data

      for (let serie of result.content) {
        let serieUpdated = new Date(serie.metadata.lastModified)

        if (serieUpdated >= time) {
          if (ids.includes(serie)) {
              foundIds.push(serie)
          }
        }
        else {
          loadMore = false
          break
        }
      }

      // If no series were returned we are on the last page
      if (result.content.length === 0){
        loadMore = false
      }

      page = page + 1

      if (foundIds.length > 0) {
        mangaUpdatesFoundCallback(createMangaUpdates({
          ids: foundIds
        }))
      }
    }
  }

  /*
  getMangaShareUrl(mangaId: string) {
    return `${KOMGA_API_DOMAIN}/series/${mangaId}`
  }
  */

  async getSourceMenu(): Promise<SourceMenu> {
    return Promise.resolve(createSection({
      id: "sourceSettings",
      header: "Source Settings",
      footer: "Footer",
      rows: () => {
        return Promise.resolve([
          createLabel({
            id:"m",
            label:"mmm",
            value: ""
          }),
          createNavigationButton({
            label: "Server Settings",
            id: "serverSettings",
            value: "",
            form: createForm({
              //@ts-ignore
              onSubmit: (values: Record<string, any>) => {
                console.log("saving")
                console.log(JSON.stringify(values, null, 2));
              },

              
              sections: () => Promise.resolve([
                createSection({
                  id: "information",
                  header: "Komga",
                  rows: () => {
                    return Promise.resolve([
                      createMultilineLabel({
                        label: "Enter your Komga server credentials\nTo test the source, a demonstration server is available on:\nhttps://komga.org/guides/#demo",
                        value: "",
                        id: "description"
                      })
                    ])
                  }
                }),

                createSection({
                  id: "serverSettings",
                  header: "Server Settings",
                  rows: () => {
                    return Promise.resolve([
                      createInputField({
                        id: 'serverAddress',
                        label: 'Server URL',
                        placeholder: 'http://127.0.0.1:8080',
                        value: "test",
                        maskInput: false,
                      }),
                      createInputField({
                        id: 'serverUsername',
                        label: 'Username',
                        placeholder: 'AnimeLover420',
                        value: "",
                        maskInput: false,
                      }),
                      createInputField({
                        id: 'serverPassword',
                        label: 'Password',
                        placeholder: 'Some Super Secret Password',
                        value: "",
                        maskInput: true,
                      }),
                      
                      /*
                      createLink({
                        label: "komga",
                        id: "lin",
                        value: "value"
                      })
                      */
                    ])
                  }
                })


                ,


                
              ])
            })
          })
        ])
      }
    }))
  }

  /*
  async getSourceMenuItemForm(itemId: string): Promise<UserForm> {
    let objects: FormObject[] = [
      createTextFieldObject({
        id: 'serverAddress',
        label: 'Server URL',
        placeholderText: 'http://127.0.0.1:8080',
        value: await this.stateManager.retrieve('serverAddress')
      }),
      createTextFieldObject({
        id: 'serverUsername',
        label: 'Username',
        placeholderText: 'AnimeLover420',
        value: await this.stateManager.retrieve('serverUsername')
      }),
      createTextFieldObject({
        id: 'serverPassword',
        label: 'Password',
        placeholderText: 'Some Super Secret Password',
        value: await this.stateManager.retrieve('serverPassword')
      })
    ]

    return createUserForm({formElements: objects})
  }
  */

  async submitSourceMenuItemForm(itemId: string, form: any) {
    var promises: Promise<void>[] = []

    Object.keys(form).forEach(key => {
      promises.push(this.stateManager.store(key, form[key]))
    })

    const authorization = this.createAuthorizationString(form["serverUsername"], form["serverPassword"])
    const komgaAPI = this.createKomgaAPI(form["serverAddress"])

    // To test these information, we try to make a connection to the server
    // We could use a better endpoint to test the connection
    let request = createRequestObject({
      url: `${komgaAPI}/series/`,
      param: "?size=1", // We don't want the server to send to many results
      method: "GET",
      incognito: true, // We don't want the authorization to be cached
      headers: {authorization: authorization}
    })

    var responseStatus = undefined

    try {
      const response = await this.requestManager.schedule(request, 1)
      responseStatus = response.status
    } catch (error) {
      // If the server is unavailable error.message will be 'AsyncOperationTimedOutError'
      throw new Error(`Could not connect to server: ${error.message}`)
    }
    
    switch(responseStatus) { 
      case 200: {
        // Successful connection
        break
      }
      case 401: {
        throw new Error("401 Unauthorized: Invalid credentials")
      }
      default: {
        throw new Error(`Connection failed with status code ${responseStatus}`)
      }
    }

    // We only want to save the info submerged if the request was successful

    promises.push(this.stateManager.store("serverAddress", form["serverAddress"]))
    promises.push(this.stateManager.store("serverUsername", form["serverUsername"]))
    promises.push(this.stateManager.store("serverPassword", form["serverPassword"]))
    // We save the authorization string and api url to not have to generate it for every request
    promises.push(this.stateManager.store("authorization", authorization))
    promises.push(this.stateManager.store("komgaAPI", komgaAPI))

    await Promise.all(promises)
  }
}
