# blocks.json

This is the main configuration file use to control which blocks are imported and to set global variables. The skeleton repo provides a sample blocks.json the contains all of the Out Of the Box feeds already listed in the blocks array. Normally the only things you need to change in blocks.json are the siteProperties.

## sample configuration file

```json
{
  "org": "@wpmedia/",
  "useLocal": false,
  "blocks": [
    "@wpmedia/feeds-source-content-api-block",
    "@wpmedia/feeds-source-video-api-block",
    "@wpmedia/mrss-feature-block",
    "@wpmedia/rss-feature-block",
    "@wpmedia/rss-fbia-feature-block",
    "@wpmedia/rss-flipboard-feature-block",
    "@wpmedia/rss-google-news-feature-block",
    "@wpmedia/rss-msn-feature-block",
    "@wpmedia/sitemap-news-feature-block",
    "@wpmedia/sitemap-video-feature-block",
    "@wpmedia/sitemap-feature-block",
    "@wpmedia/sitemap-index-feature-block"
  ],
  "values": {
    "default": {
      "siteProperties": {
        "feedTitle": "Outbound Feeds",
        "feedDomainURL": "http://localhost",
        "feedLanguage": "en",
        "resizerURL": "http://localhost/resizer",
        "feedDefaultQuery": "[{\"term\":{\"type\":\"story\"}}]"
      }
    },
    "sites": {
      "website1": {
        "siteProperties": {
          "feedTitle": "website 1",
          "feedDomainURL": "https://www.website1.com",
          "feedLanguage": "en",
          "resizerURL": "https://www.website1.com/resizer"
        }
      },
      "website2": {
        "siteProperties": {
          "feedTitle": "website 2",
          "feedDomainURL": "https://www.website2.com",
          "feedLanguage": "es",
          "resizerURL": "https://www.website2.com/resizer"
        }
      }
    }
  }
}
```

- org: The name of the npm repository, is should always be "@wpmedia"
- useLocal: true or false. If you have a local repo of blocks you can set this to true while doing local development. But generally this is not the recommended client workflow.
- blocks: An array of npm packages that will be loaded by the arc-fusion/cli at run time
- values: global configuration variables. The values set in default will be used by all websites. Any values set it a website specific section will override any default settings.

## feeds configs

- feedDomainURL - The fully qualified url for the site. It must not end in a slash.
- resizerURL - The fully qualified url for the sites resizer. It must not end in a slash. Typically this is the same as the feedDomainURL with a /resizer.
- feedTitle - The name of your website. This will be used as the title in RSS feeds
- feedLanguage - The ISO-3166 two letter country code.
- feedDefaultQuery - Optional, this overrides the default query used in feeds-source-content-api-block which is stories with last_updated_date from the last 2 days. The feedDefaultQuery value must be a valid json array in the format:

```json
"[{\"term\":{\"type\":\"story\"}},{\"range\":{\"last_updated_date\":{\"gte\":\"now-2d\",\"lte\":\"now\"}}}]"
```