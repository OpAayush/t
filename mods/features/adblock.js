import { configRead } from "../config.js";
import Chapters from "../ui/chapters.js";
import resolveCommand from "../resolveCommand.js";
import { timelyAction, longPressData } from "../ui/ytUI.js";
import { PatchSettings } from "../ui/customYTSettings.js";

/**
 * This is a minimal reimplementation of the following uBlock Origin rule:
 * https://github.com/uBlockOrigin/uAssets/blob/3497eebd440f4871830b9b45af0afc406c6eb593/filters/filters.txt#L116
 *
 * This in turn calls the following snippet:
 * https://github.com/gorhill/uBlock/blob/bfdc81e9e400f7b78b2abc97576c3d7bf3a11a0b/assets/resources/scriptlets.js#L365-L470
 *
 * Seems like for now dropping just the adPlacements is enough for YouTube TV
 */
const origParse = JSON.parse;
JSON.parse = function () {
  const r = origParse.apply(this, arguments);
  if (r.adPlacements && configRead("enableAdBlock")) {
    r.adPlacements = [];
  }

  // Also set playerAds to false, just incase.
  if (r.playerAds && configRead("enableAdBlock")) {
    r.playerAds = false;
  }

  // Also set adSlots to an empty array, emptying only the adPlacements won't work.
  if (r.adSlots && configRead("enableAdBlock")) {
    r.adSlots = [];
  }
  if (r?.streamingData?.adaptiveFormats) {
    // Remove quality restrictions and ensure all qualities are available
    r.streamingData.adaptiveFormats = r.streamingData.adaptiveFormats.map(
      (format) => {
        // Remove restrictions that might limit quality
        delete format.targetDurationSec;
        delete format.maxDvrDurationSec;

        // Ensure quality labels are preserved and formats are marked as available
        if (format.qualityLabel) {
          format.quality = format.quality || "hd1080";
        }
        return format;
      }
    );
  }

  // Force set default quality to 1440p (or highest available)
  if (r?.playerConfig?.streamSelectionConfig) {
    r.playerConfig.streamSelectionConfig.maxBitrate = "MAX";
  }

  if (r?.responseContext?.webResponseContext) {
    if (!r.responseContext.webResponseContext.playerConfig) {
      r.responseContext.webResponseContext.playerConfig = {};
    }
    r.responseContext.webResponseContext.playerConfig.preferredQuality =
      "hd1440";
  }

  // Force enable higher qualities in playback tracking
  if (r?.playbackTracking) {
    r.playbackTracking.setAutoQuality = false;
  }

  // Set quality preference in player response
  if (r?.videoDetails) {
    if (!r.playerConfig) r.playerConfig = {};
    r.playerConfig.audioConfig = r.playerConfig.audioConfig || {};
    r.playerConfig.audioConfig.enablePerFormatLoudness = false;

    // Force quality selection
    if (!r.streamingData) r.streamingData = {};
    r.streamingData.formatSelection = {
      selectedQuality: "hd1440",
    };
  }
  // Drop "masthead" ad from home screen
  if (
    r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content
      ?.sectionListRenderer?.contents &&
    configRead("enableAdBlock")
  ) {
    r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents =
      r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents.filter(
        (elm) => !elm.adSlotRenderer
      );

    for (const shelve of r.contents.tvBrowseRenderer.content
      .tvSurfaceContentRenderer.content.sectionListRenderer.contents) {
      if (shelve.shelfRenderer) {
        shelve.shelfRenderer.content.horizontalListRenderer.items =
          shelve.shelfRenderer.content.horizontalListRenderer.items.filter(
            (item) => !item.adSlotRenderer
          );
      }
    }
  }

  // Remove shorts ads
  if (!Array.isArray(r) && r?.entries && configRead("enableAdBlock")) {
    r.entries = r.entries?.filter(
      (elm) => !elm?.command?.reelWatchEndpoint?.adClientParams?.isAd
    );
  }

  // Patch settings

  if (r?.title?.runs) {
    PatchSettings(r);
  }

  // DeArrow Implementation. I think this is the best way to do it. (DOM manipulation would be a pain)

  if (
    r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content
      ?.sectionListRenderer?.contents
  ) {
    processShelves(
      r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content
        .sectionListRenderer.contents
    );
  }

  if (r?.contents?.sectionListRenderer?.contents) {
    processShelves(r.contents.sectionListRenderer.contents);
  }

  if (r?.continuationContents?.sectionListContinuation?.contents) {
    processShelves(r.continuationContents.sectionListContinuation.contents);
  }

  if (r?.continuationContents?.horizontalListContinuation?.items) {
    deArrowify(r.continuationContents.horizontalListContinuation.items);
    hqify(r.continuationContents.horizontalListContinuation.items);
    addLongPress(r.continuationContents.horizontalListContinuation.items);
  }

  if (r?.contents?.singleColumnWatchNextResults?.results?.results?.contents) {
    for (const content of r.contents.singleColumnWatchNextResults.results
      .results.contents) {
      if (content.shelfRenderer?.content?.horizontalListRenderer?.items) {
        hqify(content.shelfRenderer.content.horizontalListRenderer.items);
        deArrowify(content.shelfRenderer.content.horizontalListRenderer.items);
        addLongPress(
          content.shelfRenderer.content.horizontalListRenderer.items
        );
      }
      if (content.itemSectionRenderer?.contents) {
        for (const item of content.itemSectionRenderer.contents) {
          if (item.compactVideoRenderer?.thumbnail?.thumbnails) {
            hqifyCompactRenderer(item.compactVideoRenderer);
          }
        }
      }
    }
  }

  // Add HQ thumbnails for autoplay next video
  if (
    r?.playerOverlays?.playerOverlayRenderer?.autoplay
      ?.playerOverlayAutoplayRenderer?.videoDetails?.compactVideoRenderer
      ?.thumbnail?.thumbnails
  ) {
    hqifyCompactRenderer(
      r.playerOverlays.playerOverlayRenderer.autoplay
        .playerOverlayAutoplayRenderer.videoDetails.compactVideoRenderer
    );
  }

  if (
    !configRead("enableShorts") &&
    r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content
  ) {
    r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents =
      r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.content.sectionListRenderer.contents.filter(
        (shelve) =>
          shelve.shelfRenderer?.tvhtml5ShelfRendererType !==
          "TVHTML5_SHELF_RENDERER_TYPE_SHORTS"
      );
  }

  /*

  Chapters are disabled due to the API removing description data which was used to generate chapters

  if (r?.contents?.singleColumnWatchNextResults?.results?.results?.contents && configRead('enableChapters')) {
    const chapterData = Chapters(r);
    r.frameworkUpdates.entityBatchUpdate.mutations.push(chapterData);
    resolveCommand({
      "clickTrackingParams": "null",
      "loadMarkersCommand": {
        "visibleOnLoadKeys": [
          chapterData.entityKey
        ],
        "entityKeys": [
          chapterData.entityKey
        ]
      }
    });
  }*/

  // Manual SponsorBlock Skips

  if (
    configRead("sponsorBlockManualSkips").length > 0 &&
    r?.playerOverlays?.playerOverlayRenderer
  ) {
    const manualSkippedSegments = configRead("sponsorBlockManualSkips");
    let timelyActions = [];
    if (window?.sponsorblock?.segments) {
      for (const segment of window.sponsorblock.segments) {
        if (manualSkippedSegments.includes(segment.category)) {
          const timelyActionData = timelyAction(
            `Skip ${segment.category}`,
            "SKIP_NEXT",
            {
              clickTrackingParams: null,
              showEngagementPanelEndpoint: {
                customAction: {
                  action: "SKIP",
                  parameters: {
                    time: segment.segment[1],
                  },
                },
              },
            },
            segment.segment[0] * 1000,
            segment.segment[1] * 1000 - segment.segment[0] * 1000
          );
          timelyActions.push(timelyActionData);
        }
      }
      r.playerOverlays.playerOverlayRenderer.timelyActionRenderers =
        timelyActions;
    }
  }

  return r;
};

// Patch JSON.parse to use the custom one
window.JSON.parse = JSON.parse;
for (const key in window._yttv) {
  if (
    window._yttv[key] &&
    window._yttv[key].JSON &&
    window._yttv[key].JSON.parse
  ) {
    window._yttv[key].JSON.parse = JSON.parse;
  }
}

function processShelves(shelves) {
  for (const shelve of shelves) {
    if (shelve.shelfRenderer) {
      deArrowify(shelve.shelfRenderer.content.horizontalListRenderer.items);
      hqify(shelve.shelfRenderer.content.horizontalListRenderer.items);
      addLongPress(shelve.shelfRenderer.content.horizontalListRenderer.items);
    }
  }
}

function deArrowify(items) {
  for (const item of items) {
    if (item.adSlotRenderer) {
      const index = items.indexOf(item);
      items.splice(index, 1);
      continue;
    }
    if (configRead("enableDeArrow")) {
      const videoID = item.tileRenderer.contentId;
      fetch(`https://sponsor.ajay.app/api/branding?videoID=${videoID}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.titles.length > 0) {
            const mostVoted = data.titles.reduce((max, title) =>
              max.votes > title.votes ? max : title
            );
            item.tileRenderer.metadata.tileMetadataRenderer.title.simpleText =
              mostVoted.title;
          }

          if (
            data.thumbnails.length > 0 &&
            configRead("enableDeArrowThumbnails")
          ) {
            const mostVotedThumbnail = data.thumbnails.reduce(
              (max, thumbnail) =>
                max.votes > thumbnail.votes ? max : thumbnail
            );
            if (mostVotedThumbnail.timestamp) {
              item.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails =
                [
                  {
                    url: `https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=${videoID}&time=${mostVotedThumbnail.timestamp}`,
                    width: 1280,
                    height: 640,
                  },
                ];
            }
          }
        });
    }
  }
}

function hqify(items) {
  for (const item of items) {
    // --- Safety Check ---
    // Make sure the path to the thumbnail URL exists before we try to read it.
    // This prevents errors on new or unknown tile types.
    if (
      !item.tileRenderer?.header?.tileHeaderRenderer?.thumbnail?.thumbnails?.[0]
        ?.url
    ) {
      continue;
    }

    const thumbnails =
      item.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails;

    // Check if the item is part of the home page recommendations
    if (item.tileRenderer.style === "TILE_STYLE_YTLR_DEFAULT") {
      // Attempt to load high-quality thumbnails
      hqifyThumbnailArray(thumbnails);
    } else {
      // For other items, you can keep the existing logic or modify as needed
      hqifyThumbnailArray(thumbnails);
    }
  }
}

function hqifyCompactRenderer(compactVideoRenderer) {
  if (!compactVideoRenderer?.thumbnail?.thumbnails?.[0]?.url) {
    return;
  }
  hqifyThumbnailArray(compactVideoRenderer.thumbnail.thumbnails);
}

function hqifyThumbnailArray(thumbnails) {
  if (!configRead("enableHqThumbnails")) return;
  if (!thumbnails || thumbnails.length === 0) return;

  const originalUrl = thumbnails[0].url;

  // --- Safety Check 2 ---
  // Ensure it's a standard YouTube video thumbnail URL.
  // This will skip things like channel icons which have a different URL structure.
  if (!originalUrl.includes("i.ytimg.com/vi/")) {
    return;
  }

  try {
    // --- FIX FOR PLAYLISTS/MIXES ---
    // We get the videoID from the thumbnail URL itself, not from 'contentId'.
    // For playlists, 'contentId' is 'PL...' which breaks the thumbnail URL.
    // The thumbnail URL *always* has the correct video ID.
    // e.g., https://i.ytimg.com/vi/VIDEO_ID/hqdefault.jpg?query

    const urlObj = new URL(originalUrl);
    const pathParts = urlObj.pathname.split("/"); // ["", "vi", "VIDEO_ID", "hqdefault.jpg"]
    const videoID = pathParts[2]; // This gets the VIDEO_ID
    const queryArgs = urlObj.search; // This gets the full query string (e.g., "?sqp=...")

    if (!videoID) return; // Skip if we couldn't parse a video ID

    // --- FIX FOR MAX RES FALLBACK ---
    // We replace the thumbnails array with a new array.
    // The client will try to load them in order.
    // 1. Try maxresdefault.jpg (1280x720 or 1920x1080)
    // 2. If that fails or isn't available, it will fall back to sddefault.jpg (640x480)
    thumbnails.length = 0; // Clear existing array
    thumbnails.push({
      url: `https://i.ytimg.com/vi/${videoID}/maxresdefault.jpg${
        queryArgs || ""
      }`,
      width: 1280,
      height: 720,
    });
  } catch (e) {
    // If something goes wrong (like a weird URL), log it and continue
    console.error("TizenTube: Failed to hqify thumbnail", e, originalUrl);
  }
}

function addLongPress(items) {
  if (!configRead("enableLongPress")) return;
  for (const item of items) {
    if (item.tileRenderer.style !== "TILE_STYLE_YTLR_DEFAULT") continue;
    if (item.tileRenderer.onLongPressCommand) continue;
    const subtitle =
      item.tileRenderer.metadata.tileMetadataRenderer.lines[0].lineRenderer
        .items[0].lineItemRenderer.text;
    const data = longPressData({
      videoId: item.tileRenderer.contentId,
      thumbnails:
        item.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails,
      title: item.tileRenderer.metadata.tileMetadataRenderer.title.simpleText,
      subtitle: subtitle.runs ? subtitle.runs[0].text : subtitle.simpleText,
      watchEndpointData: item.tileRenderer.onSelectCommand.watchEndpoint,
    });
    item.tileRenderer.onLongPressCommand = data;
  }
}
