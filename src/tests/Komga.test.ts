import cheerio from "cheerio";
import { Komga } from "../Komga/Komga";
import { APIWrapper, Source } from "paperback-extensions-common";

describe("Komga Tests", function () {
  var wrapper: APIWrapper = new APIWrapper();
  var source: Source = new Komga(cheerio);
  var chai = require("chai"),
    expect = chai.expect;
  var chaiAsPromised = require("chai-as-promised");
  chai.use(chaiAsPromised);


  // THIS IS THE NEW BIT - By doing this, any retrieval done in your source should properly retrieve these values
  before(function() {
    // This will run before ANY test. Set your state values here
    source.stateManager.store("serverAddress", "http://192.168.0.23:8081") // Or whatever your endpoint is
    source.stateManager.store("serverUsername", "demo@komga.org")
    source.stateManager.store("serverPassword", "komga-demo")
  });

  //var mangaId = "63";
  var mangaId = "0451Q4Q58E40R";

  it("Retrieve Manga Details", async () => {
    let details = await wrapper.getMangaDetails(source, mangaId);
    expect(
      details,
      "No results found with test-defined ID [" + mangaId + "]"
    ).to.exist;

    // Validate that the fields are filled
    let data = details;
    expect(data.id, "Missing ID").to.be.not.empty;
    expect(data.titles, "Missing Titles").to.be.not.empty;
    expect(data.image, "Missing Image").to.be.not.empty;
    expect(data.status, "Missing Status").to.exist;

    expect(data.langFlag, "Missing LangFlag").to.exist;
    expect(data.artist, "Missing Artist").to.exist;
    expect(data.author, "Missing Author").to.exist;
    expect(data.desc, "Missing Desc").to.exist;
    expect(data.tags, "Missing Tags").to.exist;
    expect(data.lastUpdate, "Missing LastUpdate").to.exist;
  });
  
  
  it("Get Chapters", async () => {
    let data = await wrapper.getChapters(source, mangaId);

    expect(data, "No chapters present for: [" + mangaId + "]").to.not.be.empty;

    let entry = data[0];
    expect(entry.id, "No ID present").to.not.be.empty;
    expect(entry.time, "No date present").to.exist;
    expect(entry.name, "No title available").to.not.be.empty;
    expect(entry.chapNum, "No chapter number present").to.exist;
    //expect(entry.volume, "No volume data available").to.not.be.empty;

    //expect(entry.langCode, "No langCode present").to.exist;
  });
  

  it("Get Chapter Details", async () => {
    let chapters = await wrapper.getChapters(source, mangaId);
    let data = await wrapper.getChapterDetails(source, mangaId, chapters[0].id);

    expect(data, "No server response").to.exist;
    expect(data, "Empty server response").to.not.be.empty;

    expect(data.id, "Missing ID").to.be.not.empty;
    expect(data.mangaId, "Missing MangaID").to.be.not.empty;
    expect(data.pages, "No pages present").to.be.not.empty;
  });

  it("Testing search", async () => {
    let testSearch = createSearchRequest({
      title: "Kimi",
      // title: "Space Adventures",
    });

    let search = await wrapper.searchRequest(source, testSearch);
    let result = search.results[0];

    expect(result, "No response from server").to.exist;

    expect(result.id, "No ID found for search query").to.be.not.empty;
    expect(result.image, "No image found for search").to.be.not.empty;
    expect(result.title, "No title").to.be.not.null;
    expect(result.subtitleText, "No subtitle text").to.be.not.null;
  });


  it("Testing Home-Page aquisition", async () => {
    let homePages = await wrapper.getHomePageSections(source);
    expect(homePages, "No response from server").to.exist;
  });

});
