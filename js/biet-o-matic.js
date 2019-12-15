/*
 * biet-o-matic.js - Ebay Article Overview (Extension Popup)
 * =======================================================
 * - Display each Ebay Article Tab in a Table
 * - Receives events from Ebay Article Tab Content Script
 * - Manages a simple database (e.g. containing the max-bids)
 *
 * By Sebastian Weitzel, sebastian.weitzel@gmail.com
 *
 * Apache License Version 2.0, January 2004, http://www.apache.org/licenses/
 */

let popup = function () {
  'use strict';

  let pt = {};

  function onError(error, sender = null) {
    console.error("Biet-O-Matic: Promise Error: %O, Sender: %O", error, sender);
  }

  /*
   register events:
     - ebayArticleUpdated: from content script with info about article
     - ebayArticleRefresh: from content script, simple info to refresh the row (update remaing time)
     - updateArticleStatus: from content script to update the Auction State with given info
     - ebayArticleMaxBidUpdated: from content script to update maxBid info
     - getWindowSettings: from content script to retrieve the settings for this window (e.g. autoBidEnabled)
     - addArticleLog: from content script to store log info for article
     - getArticleInfo: return article info from row
     - getArticleSyncInfo: return article info from sync storage
     - browser.tabs.onremoved: Tab closed
   */
  function registerEvents() {
    // listen to global events (received from other Browser window or background script)
    browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
      //console.debug('runtime.onMessage listener fired: request=%O, sender=%O', request, sender);
      switch (request.action) {
        case 'ebayArticleUpdated':
          if (pt.whoIAm.currentWindow.id === sender.tab.windowId) {
            console.debug("Biet-O-Matic: Browser Event ebayArticleUpdated received: tab=%s, articleId=%s, articleDescription=%s",
              sender.tab.id, request.detail.articleId, request.detail.articleDescription);
            addOrUpdateArticle(sender.tab, request.detail)
              .catch(e => {
                console.debug ("Biet-O-Matic: addOrUpdateArticle() failed - %s", JSON.stringify(e));
              });
            // update BE favicon for this tab
            updateFavicon($('#inpAutoBid').prop('checked'), sender.tab);
          }
          break;
        case 'ebayArticleRefresh':
          if (pt.whoIAm.currentWindow.id === sender.tab.windowId) {
            console.debug("Biet-O-Matic: Browser Event ebayArticleRefresh received from tab %s", sender.tab.id);
            // redraw date (COLUMN 3)
            let dateCell = pt.table.cell(`#${sender.tab.id}`, 'articleEndTime:name');
            // redraw date
            dateCell.invalidate('data').draw();
          }
          break;
        case 'updateArticleStatus':
          if (pt.whoIAm.currentWindow.id === sender.tab.windowId) {
            console.debug("Biet-O-Matic: Browser Event updateArticleStatus received from tab %s: sender=%O, detail=%s",
              sender.tab.id, sender, JSON.stringify(request.detail));
            let row = pt.table.row(`#${sender.tab.id}`);
            let data = row.data();
            // redraw status (COLUMN 6)
            let statusCell = pt.table.cell(`#${sender.tab.id}`, 'articleAuctionState:name');
            data.articleAuctionState = request.detail.message;
            statusCell.invalidate('data').draw();
          }
          break;
        case 'ebayArticleMaxBidUpdated':
          if (pt.whoIAm.currentWindow.id === sender.tab.windowId) {
            console.debug("Biet-O-Matic: Browser Event ebayArticleMaxBidUpdate received: sender=%O, detail=%O", sender, request.detail);
            let row = pt.table.row(`#${sender.tab.id}`);
            updateRowMaxBid(row, request.detail);
            storeArticleInfo(request.articleId, request.detail).catch(e => {
              console.log("Biet-O-Matic: Unable to store article info: %O", e);
            });
          }
          break;
        case 'getWindowSettings':
          if (pt.whoIAm.currentWindow.id === sender.tab.windowId) {
            console.debug("Biet-O-Matic: Browser Event getWindowSettings received: sender=%O", sender);
            return Promise.resolve(JSON.parse(window.sessionStorage.getItem('settings')));
          }
          break;
        case 'addArticleLog':
          if (pt.whoIAm.currentWindow.id === sender.tab.windowId) {
            console.debug("Biet-O-Matic: Browser Event addArticleLog received: tab=%d, detail=%s",
              sender.tab.id, JSON.stringify(request.detail));
            let row = pt.table.row(`#${sender.tab.id}`);
            let data = row.data();
            // redraw status (COLUMN 6)
            if (request.detail.message.level !== "Performance") {
              // only if its not performance info (too verboose)
              let statusCell = pt.table.cell(`#${sender.tab.id}`, 'articleAuctionState:name');
              data.articleAuctionState = request.detail.message.message;
              statusCell.invalidate('data').draw();
            }
            storeArticleLog(request.articleId, request.detail);
          }
          break;
        case 'getArticleInfo':
          if (pt.whoIAm.currentWindow.id === sender.tab.windowId) {
            console.debug("Biet-O-Matic: Browser Event getArticleInfo received: sender=%O", sender);
            if (request.hasOwnProperty('articleId')) {
              // determine row by articleId
              let row = pt.table.row(`:contains(${request.articleId})`);
              return Promise.resolve({
                data: row.data(),
                tabId: sender.tab.id
              });
            }
          }
          break;
        case 'getArticleSyncInfo':
          if (pt.whoIAm.currentWindow.id === sender.tab.windowId) {
            console.debug("Biet-O-Matic: Browser Event getArticleSyncInfo received: sender=%O, article=%s",
              sender, request.articleId);
            if (request.hasOwnProperty('articleId')) {
              return Promise.resolve(browser.storage.sync.get(request.articleId));
            }
          }
          break;
        case 'ebayArticleSetAuctionEndState':
          if (pt.whoIAm.currentWindow.id === sender.tab.windowId) {
            let v = (typeof request.detail.auctionEndState !== 'undefined') ? request.detail.auctionEndState : null;
            console.debug("Biet-O-Matic: Browser Event ebayArticleSetAuctionEndState received: sender=%O, state=%s", sender, v);
            if (request.hasOwnProperty('articleId')) {
              // determine row by articleId
              // let row = pt.table.row(`:contains(${request.articleId})`);
              //let row = pt.table.row(`#${sender.tab.id}`);
              // todo more logic needed for other articles
              storeArticleInfo(request.articleId, request.detail).catch(e => {
                console.log("Biet-O-Matic: Unable to store article info: %s", e.message);
              });
            }
          }
          break;
      }
    });

    // tab closed
    browser.tabs.onRemoved.addListener(function (tabId, removeInfo) {
      console.debug('Biet-O-Matic: tab(%d).onRemoved listener fired: %s', tabId, JSON.stringify(removeInfo));
      // window closing, no need to update anybody
      if (removeInfo.isWindowClosing === false) {
        // remove tab from table
        let row = pt.table.row(`#${tabId}`);
        if (row.length === 1) {
          row.remove().draw();
        }
      }
    });
    // tab reloaded
    /*browser.tabs.onUpdated.addListener(function (tabId, changeInfo, tabInfo) {
      console.debug('Biet-O-Matic: tab(%d).onUpdated listener fired: change=%s, tab=%O', tabId, JSON.stringify(changeInfo), tabInfo);
    });
     */

    // toggle autoBid for window when button in browser menu clicked
    // the other button handler is setup below
    browser.browserAction.onClicked.addListener(function (tab, clickData) {
      if (pt.whoIAm.currentWindow.id === tab.windowId) {
        console.debug('Biet-O-Matic: browserAction.onClicked listener fired: tab=%O, clickData=%O', tab, clickData);
        const toggle = $('#inpAutoBid');
        let checked = toggle.prop('checked');
        // only toggle favicon for ebay tabs
        if (tab.url.startsWith(browser.extension.getURL("")) || tab.url.match(/^https?:\/\/.*\.ebay\.(de|com)\/itm/)) {
          toggle.prop('checked', !checked);
          updateSetting('autoBidEnabled', !checked);
          // note, in chrome the action click cannot be modified with shift
          updateSetting('simulate', false);
          updateFavicon(!checked, null, false);
        }
      }
    });

    // inpAutoBid checkbox
    const inpAutoBid = $('#inpAutoBid');
    inpAutoBid.on('click', e => {
      e.stopPropagation();
      console.debug('Biet-O-Matic: Automatic mode toggled: %s - shift=%s, ctrl=%s', inpAutoBid.is(':checked'), e.shiftKey, e.ctrlKey);
      updateSetting('autoBidEnabled', inpAutoBid.is(':checked'));
      // when shift is pressed while clicking autobid checkbox, enable Simulation mode
      if (inpAutoBid.is(':checked') && e.shiftKey) {
        console.log("Biet-O-Matic: Enabling Simulation mode.");
        updateFavicon(inpAutoBid.is(':checked'), null, true);
        updateSetting('simulate', true);
        $("#lblAutoBid").text('Automatikmodus (Test)');
      } else {
        updateFavicon(inpAutoBid.is(':checked'), null, false);
        updateSetting('simulate', false);
        $("#lblAutoBid").text('Automatikmodus');
      }
    });
    const inpBidAll = $('#inpBidAll');
    inpBidAll.on('click', (e) => {
      console.debug('Biet-O-Matic: Bid all articles mode toggled: %s', inpBidAll.is(':checked'));
      updateSetting('bidAllEnabled', inpBidAll.is(':checked'));
    });
  }

  /*
  * detectWhoAmI
  *   Detect if the current window belongs to a topic
  *   If a topic matched, updates Favicon as well
  */
  async function detectWhoIAm() {
    let ret = {};
    // first determine simply which window currently running on
    ret.currentWindow = await browser.windows.getCurrent({populate: true});
    console.debug("Biet-O-Matic: detectWhoIAm(): window=%O", ret.currentWindow);
    return ret;
  }

  /*
   * Request article info form specific tab
   */
  async function getArticleInfoForTab(tab) {
    // e.g. https://www.ebay.de/itm/*
    let regex = /^https:\/\/www.ebay.(de|com)\/itm/i;
    if (!tab.url.match(regex)) {
      return Promise.resolve({});
    }
    // inject content script in case its not loaded
    await browser.tabs.executeScript(tab.id, {file: 'thirdparty/browser-polyfill.min.js'});
    await browser.tabs.insertCSS(tab.id, {file: "css/contentScript.css"});
    await browser.tabs.executeScript(tab.id, {file: 'js/contentScript.js'});
    return Promise.resolve(browser.tabs.sendMessage(tab.id, {action: 'GetArticleInfo'}));
  }

  /*
    Add or Update Article in Table
    - if articleId not in table, add it
    - if if table, update the entry
    - also complement the date with info from DB
  */
  async function addOrUpdateArticle(tab, info) {
    if (!info.hasOwnProperty('articleId')) {
      return;
    }
    let articleId = info.articleId;
    console.debug('Biet-O-Matic: addOrUpdateArticle(%s) tab=%O, info=%O', articleId, tab, info);
    info.tabId = tab.id;

    // complement with DB info
    let maxBid = null;
    let autoBid = false;
    let result = await browser.storage.sync.get(articleId);
    if (Object.keys(result).length === 1) {
      let storInfo = result[articleId];
      console.debug("Biet-O-Matic: Found info for Article %s in storage: %s", articleId, JSON.stringify(result));
      // maxBid
      if (storInfo.hasOwnProperty('maxBid') && storInfo.maxBid != null) {
        if (typeof storInfo.maxBid === 'string') {
          maxBid = Number.parseFloat(storInfo.maxBid).toFixed(2);
        } else {
          maxBid = storInfo.maxBid.toFixed(2);
        }
      }
      // autoBid
      if (storInfo.hasOwnProperty('autoBid')) {
        autoBid = storInfo.autoBid;
      }
      // if articleEndTime changed, update it in storage
      if (!storInfo.hasOwnProperty('endTime') || storInfo.endTime !== info.articleEndTime) {
        storInfo.endTime = info.articleEndTime;
        console.log("Biet-O-Matic: Updating article %s end time to %s", articleId, storInfo.endTime);
        storeArticleInfo(articleId, storInfo);
      }
    }
    info.articleMaxBid = maxBid;
    info.articleAutoBid = autoBid;

    // article already in table
    let rowByTabId = pt.table.row(`#${tab.id}`);
    // determine row by articleId
    let rowByArticleId = pt.table.row(`:contains(${articleId})`);
    //console.log("XXX tabid=%O, articleid=%O, this TabId=%d", rowByTabId.data(), rowByArticleId.data(), info.tabId);
    // check if article is already open in another tab
    if (rowByArticleId.length !== 0 && typeof rowByArticleId !== 'undefined') {
      if (rowByArticleId.data().tabId !== info.tabId) {
        throw new Error(`Article ${info.articleId} already open in another tab!`);
      }
    }
    if (rowByTabId.length === 0 || typeof rowByTabId === 'undefined') {
      // article not in table - simply add it
      addActiveArticleTab(info);
    } else {
      // article in table - update it
      updateActiveArticleTab(info, rowByTabId);
    }

    // assign again, the row might have been just initialized
    rowByTabId = pt.table.row(`#${tab.id}`);

    // add highlight colors for expired auctions
    highlightExpired(rowByTabId, info);
  }

  /*
   * Add a new article to the active articles table
   */
  function addActiveArticleTab(info) {
    console.debug('Biet-O-Matic: addActiveArticleTab(%s), info=%O)', info.articleId, info);
    if (!info.hasOwnProperty('articleId')) {
      console.debug("addArticle skipped for tab %O, no info");
      return;

    }
    let row = pt.table.row.add(info);
    row.draw();
  }

  /*
   * Update an existing article in the active articles table
   */
  function updateActiveArticleTab(info, row) {
    console.debug('Biet-O-Matic: updateActiveArticleTab(%s) info=%O, row=%O', info.articleId, info, row);
    if (!info.hasOwnProperty('articleId')) {
      console.debug("addArticle skipped for tab %O, no info");
      return;
    }
    row.data(info).invalidate().draw();
    // todo animate / highlight changed cell or at least the row
  }

  // convert epoch to local time string
  function fixDate(info) {
    let date = 'n/a';
    if (info.hasOwnProperty('articleEndTime') && typeof info.articleEndTime !== 'undefined') {
      date = new Intl.DateTimeFormat('default', {'dateStyle': 'medium', 'timeStyle': 'medium'})
        .format(new Date(info.articleEndTime));
    }
    return date;
  }

  /*
   * Check Storage permission granted and update the HTML with relevent internal information
   * - also add listener for storageClearAll button and clear complete storage on request.
   *
   */
  async function checkBrowserStorage() {
    // total elements
    let inpStorageCount = await browser.storage.sync.get(null);
    // update html element storageCount
    $('#inpStorageCount').val(Object.keys(inpStorageCount).length);

    // total size
    let inpStorageSize = await browser.storage.sync.getBytesInUse(null);
    $('#inpStorageSize').val(inpStorageSize);

    $('#inpStorageClearAll').on('click', async e => {
      console.debug('Biet-O-Matic: Clear all data from local and sync storage, %O', e);
      await browser.storage.sync.clear();
      window.localStorage.clear();
      // reload page
      browser.tabs.reload();
    });
    $('#inpRemoveOldArticles').on('click', async function() {
      // sync storage
      let result = await browser.storage.sync.get(null);
      Object.keys(result).forEach(function(articleId) {
        let data = result[articleId];
        //Date.now = 1576359588  yesterday = 1576265988;
        let diff = (Date.now() - data.endTime) / 1000;
        if (data.hasOwnProperty('endTime') && diff > 86400) {
          console.debug("Biet-O-Matic: Deleting Article %s from sync storage, older 1 day (%s > 86000s)", articleId, diff);
          browser.storage.sync.remove(articleId).catch(e => {
            console.warn("Biet-O-Matic: Unable to remove article %s from sync storage: %s", e.message);
          });
        }
        // localStorage (logs)
        Object.keys(window.localStorage).forEach(key => {
          let value = JSON.parse(window.localStorage.getItem(key));
          let diff = (Date.now() - value[0].timestamp) / 1000;
          if (diff > 10000) {
            console.debug("Biet-O-Matic: Deleting Article %s log entries from localStorage, older 1 day (%s, %s > 86000s)",
              key, value[0].timestamp, diff);
            window.localStorage.removeItem(key);
          }
        });
      });
      // reload page
      //browser.tabs.reload();
    });
  }

  /*
   * Restore settings from window session storage
   */
  function restoreSettings() {
    // inpAutoBid
    let result = JSON.parse(window.sessionStorage.getItem('settings'));
    if (result != null) {
      console.debug("Biet-O-Matic: restoreSettings() updating from session storage: settings=%s", JSON.stringify(result));
      if (result.hasOwnProperty('autoBidEnabled')) {
        $('#inpAutoBid').prop('checked', result.autoBidEnabled);
      }
      if (result.hasOwnProperty('bidAllEnabled')) {
        $('#inpBidAll').prop('checked', result.bidAllEnabled);
      }
    }
  }
  // update setting in session storage
  function updateSetting(key, value) {
    let result = JSON.parse(window.sessionStorage.getItem('settings'));
    if (result == null) {
      result = {};
    }
    result[key] = value;
    window.sessionStorage.setItem('settings', JSON.stringify(result));
  }

  /*
   * store articleInfo to sync storage
   *   will keep update values which are provided in the info object
   * - key: articleId
   * - value: endTime, minBid, maxBid, autoBid
   */
  async function storeArticleInfo(articleId, info, tabId = null) {
    if (articleId === null || typeof articleId === 'undefined') {
      console.warn("Biet-O-Matic: storeArticleInfo() - unknown articleId! info=%O tab=%O", info, tabId);
      return;
    }
    let settings = {};
    // restore from existing config
    let result = await browser.storage.sync.get(articleId);
    if (Object.keys(result).length === 1) {
      settings = result[articleId];
    }
    // merge new info into existing settings
    let newSettings = Object.assign({}, settings, info);
    // store the settings back to the storage
    await browser.storage.sync.set({[articleId]: newSettings});
    if (tabId != null) {
      // send update to article tab
      await browser.tabs.sendMessage(tabId, {
        action: 'UpdateArticleMaxBid',
        detail: info
      });
    }
    return true;
  }

  /*
   * Append log entry for Article to local storage
   */
  function storeArticleLog(articleId, info) {
    // get info for article from storage
    let log = JSON.parse(window.localStorage.getItem(`log:${articleId}`));
    console.debug("Biet-O-Matic: storeArticleLog(%s) info=%s", articleId, JSON.stringify(info));
    if (log == null) log = [];
    log.push(info.message);
    window.localStorage.setItem(`log:${articleId}`, JSON.stringify(log));
  }
  // get the log
  function getArticleLog(articleId) {
    return JSON.parse(window.localStorage.getItem(`log:${articleId}`));
  }

  /*
   * Configure UI Elements events:
   * - maxBid Input: If auction running and value higher than the current bid, enable the autoBid checkbox for this row
   * - autoBid checkbox: when checked, the bid and autoBid status is updated in the storage
   */
  function configureUi() {
    const table = $('.dataTable');
    // maxBid input field
    table.on('change', 'tr input', e => {
      //console.debug('Biet-O-Matic: configureUi() INPUT Event this=%O', e);
      // parse articleId from id of both inputs
      let articleId = e.target.id
        .replace('chkAutoBid_', '')
        .replace('inpMaxBid_', '');
      // determine row by articleId
      const row = pt.table.row(`:contains(${articleId})`);
      let data = row.data();
      if (e.target.id.startsWith('inpMaxBid_')) {
        // maxBid was entered
        data.articleMaxBid = Number.parseFloat(e.target.value);
      } else if (e.target.id.startsWith('chkAutoBid_')) {
        // autoBid checkbox was clicked
        data.articleAutoBid = e.target.checked;
      }
      // update local with maxBid/autoBid changes
      updateRowMaxBid(row);
      // store info when maxBid updated
      let info = {
        endTime: data.articleEndTime,
        maxBid: data.articleMaxBid,
        autoBid: data.articleAutoBid
      };
      // update storage info
      storeArticleInfo(data.articleId, info, data.tabId)
        .catch(e => {
          console.warn("Biet-O-Matic: Failed to store article info: %O", e);
        });
    });

    // Add event listener for opening and closing details
    pt.table.on('click', 'td.details-control', e => {
      e.preventDefault();
      let tr = $(e.target).closest('tr');
      let row = pt.table.row(tr);
      if ( row.child.isShown() ) {
        // This row is already open - close it
        row.child.hide();
        tr.toggleClass('ui-icon-plus ui-icon-minus');
      } else {
        // Open this row
        row.child(renderArticleLog(row.data())).show();
        tr.toggleClass('ui-icon-plus ui-icon-minus');
      }
    });

    // if articleId cell is clicked, active the tab of that article
    table.on('click', 'tbody tr a', e => {
      e.preventDefault();
      // first column, jumpo to open article tab
      let tabId = e.target.id.match(/^tabid:([0-9]+)$/);
      if (tabId != null) {
        tabId = Number.parseInt(tabId[1]);
        browser.tabs.update(tabId, {active: true})
          .catch(onError);
      } else {
        // check link and open in new tab
        let href = e.target.href;
        if (href !== "#") {
          window.open(href, '_blank');
        }
      }
    });
  }

  /*
   * Updates the maxBid input and autoBid checkbox for a given row
   * Note: the update can either be triggered from the article page, or via user editing on the datatable
   * Also performs row redraw to show the updated data.
   */
  function updateRowMaxBid(row, info= {}) {
    let data = row.data();
    console.debug('Biet-O-Matic: updateRowMaxBid(%s) info=%s', data.articleId, JSON.stringify(info));
    // minBid
    if (info.hasOwnProperty('minBid')) {
      data.articleMinimumBid = info.minBid;
    }
    // maxBid
    if (info.hasOwnProperty('maxBid')) {
      if (info.maxBid == null || Number.isNaN(info.maxBid)) {
        data.articleMaxBid = 0;
      } else {
        data.articleMaxBid = info.maxBid;
      }
    }
    // autoBid
    if (info.hasOwnProperty('autoBid')) {
      if (info.autoBid != null) {
        data.articleAutoBid = info.autoBid;
      }
    }
    // invalidate data, redraw
    // todo selective redraw for parts of the row ?
    row.invalidate('data').draw();
  }

  //region Favicon Handling
  function measureText(context, text, fontface, min, max, desiredWidth) {
    if (max-min < 1) {
      return min;
    }
    let test = min+((max-min)/2); //Find half interval
    context.font=`bold ${test}px "${fontface}"`;
    let found;
    if ( context.measureText(text).width > desiredWidth) {
      found = measureText(context, text, fontface, min, test, desiredWidth);
    } else {
      found = measureText(context, text, fontface, test, max, desiredWidth);
    }
    return parseInt(found);
  }
  /* determine good contrast color (black or white) for given BG color */
  function getContrastYIQ(hexcolor){
    const r = parseInt(hexcolor.substr(0,2),16);
    const g = parseInt(hexcolor.substr(2,2),16);
    const b = parseInt(hexcolor.substr(4,2),16);
    // http://www.w3.org/TR/AERT#color-contrast
    let yiq = ((r*299)+(g*587)+(b*114))/1000;
    return (yiq >= 128) ? 'black' : 'white';
  }
  /* generate favicon based on title and color */
  function createFavicon(title, color) {
    if (typeof color !== 'string' || !color.startsWith('#')) {
      console.warn("createFavicon() skipped (invalid color): title=%s, color=%s (%s)", title, color, typeof color);
      return undefined;
    }
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    let ctx = canvas.getContext('2d');
    // background color
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 63, 63);
    // text color
    ctx.fillStyle = getContrastYIQ(color);

    let acronym = title.split(' ').map(function(item) {
      return item[0];
    }).join('').substr(0, 2);

    let fontSize = measureText(ctx, acronym, 'Arial', 0, 60, 50);
    ctx.font = `bold ${fontSize}px "Arial"`;
    ctx.textAlign='center';
    ctx.textBaseline="middle";
    ctx.fillText(acronym, 32, 38);

    // prepare icon as Data URL
    const link = document.createElement('link');
    link.type = 'image/x-icon';
    link.rel = 'shortcut icon';
    link.href = canvas.toDataURL("image/x-icon");

    return {
      link: link,
      image: ctx.getImageData(0, 0, canvas.width, canvas.height)
    };
    //document.getElementsByTagName('head')[0].appendChild(link);
  }
  function updateFavicon(checked = false, tab = null, test = false) {
    let title = 'B';
    let color = '#a6001a';
    if (checked) {
      color = '#457725';
    }
    let favUrl = createFavicon(title, color).link;
    let favImg = createFavicon(title, color).image;
    if (favUrl) {
      favUrl.id = "favicon";
      let head = document.getElementsByTagName('head')[0];
      if (document.getElementById('favicon')) {
        head.removeChild(document.getElementById('favicon'));
      }
      head.appendChild(favUrl);
    }
    if (tab == null) {
      // update browserAction Icon for all of this window Ebay Tabs (Chrome does not support windowId param)
      let query = browser.tabs.query({
        currentWindow: true,
        url: [ browser.extension.getURL("*"), "*://*.ebay.de/itm/*","*://*.ebay.com/itm/*" ]
      });
      query.then((tabs) => {
        for (let tab of tabs) {
          console.debug("Biet-O-Matic: updateFavicon(), Set icon on tab %d (%s)", tab.id, tab.url);
          browser.browserAction.setIcon({
            imageData: favImg,
            tabId: tab.id
          })
            .catch(onError);
          if (test) {
            browser.browserAction.setBadgeText({text: 'T'});
            //browser.browserAction.setBadgeBackgroundColor({color: '#fff'});
          } else {
            browser.browserAction.setBadgeText({text: ''});
          }
        }
      }, onError);
    } else {
      // update for single tab
      console.debug("Biet-O-Matic: updateFavicon(), Set icon on single tab %d (%s)", tab.id, tab.url);
      browser.browserAction.setIcon({imageData: favImg, tabId: tab.id})
        .catch(onError);
    }
  }
  //endregion


  /*
   * If an article is close to ending or ended, highlight the date
   * if it ended, highlight the status as well
   */
  function highlightExpired(row, info) {
    let rowNode = row.node();
    if (info.articleEndTime - Date.now() < 0) {
      // ended
      $(rowNode).css('color', 'red');
    } else if (info.articleEndTime - Date.now() < 60) {
      // ends in 1 minute
      $(rowNode).css('text-shadow', '2px -2px 3px #FF0000');
    }
  }

  // datable: render column articleBidPrice
  function renderArticleBidPrice(data, type, row) {
    if (typeof data !== 'undefined') {
      //console.log("data=%O, type=%O, row=%O", data, type, row);
      let currency = "EUR";
      if (row.hasOwnProperty('articleCurrency')) {
        currency = row.articleCurrency;
      }
      try {
        let result = new Intl.NumberFormat('de-DE', {style: 'currency', currency: currency})
          .format(data);
        return type === "display" || type === "filter" ? result : data;
      } catch (e) {
        return data;
      }
    }
  }

  /*
   * same logic as activateAutoBidButton from contentScript
   */
  function activateAutoBidButton(maxBidValue, minBidValue, bidPrice) {
    console.debug("Biet-O-Matic: activateAutoBidButton(), maxBidValue=%s (%s), minBidValue=%s (%s)",
      maxBidValue, typeof maxBidValue,  minBidValue, typeof minBidValue);
    //let isMaxBidEntered = (Number.isNaN(maxBidValue) === false);
    const isMinBidLargerOrEqualBidPrice = (minBidValue >= bidPrice);
    const isMaxBidLargerOrEqualMinBid = (maxBidValue >= minBidValue);
    const isMaxBidLargerThanBidPrice = (maxBidValue > bidPrice);
    if ((isMinBidLargerOrEqualBidPrice && isMaxBidLargerOrEqualMinBid) === true) {
      //console.debug("Enable bid button: (isMinBidLargerOrEqualBidPrice(%s) && isMaxBidLargerOrEqualMinBid(%s) = %s",
      //  isMinBidLargerOrEqualBidPrice, isMaxBidLargerOrEqualMinBid, isMinBidLargerOrEqualBidPrice && isMaxBidLargerOrEqualMinBid);
      return true;
    } else if (isMaxBidLargerThanBidPrice === true) {
      //console.debug("Enable bid button: isMaxBidLargerThanBidPrice=%s", isMaxBidLargerThanBidPrice);
      return true;
    } else {
      return false;
    }
  }

  /*
   * datatable: render column articleMaxBid
   * - input:number for maxBid
   * - label for autoBid and in it:
   * - input:checkbox for autoBid
   */
  function renderArticleMaxBid(data, type, row) {
    if (type !== 'display' && type !== 'filter') return data;
    //console.log("renderArticleMaxBid(%s) data=%O, type=%O, row=%O", row.articleId, data, type, row);
    let autoBid = false;
    if (row.hasOwnProperty('articleAutoBid')) {
      autoBid = row.articleAutoBid;
    }
    let maxBid = 0;
    if (data != null) {
      maxBid = data;
    }
    const divArticleMaxBid = document.createElement('div');
    const inpMaxBid = document.createElement('input');
    inpMaxBid.id = 'inpMaxBid_' + row.articleId;
    inpMaxBid.type = 'number';
    inpMaxBid.min = '0';
    inpMaxBid.step = '0.01';
    inpMaxBid.defaultValue = maxBid.toString();
    inpMaxBid.style.width = "60px";
    const labelAutoBid = document.createElement('label');
    const chkAutoBid = document.createElement('input');
    chkAutoBid.id = 'chkAutoBid_' + row.articleId;
    chkAutoBid.type = 'checkbox';
    chkAutoBid.defaultChecked = autoBid;
    chkAutoBid.style.width = '15px';
    chkAutoBid.style.height = '15px';
    chkAutoBid.style.verticalAlign = 'middle';
    labelAutoBid.appendChild(chkAutoBid);
    const spanAutoBid = document.createElement('span');
    spanAutoBid.textContent = 'Aktiv';
    labelAutoBid.appendChild(spanAutoBid);

    // maxBid was entered, check if the autoBid field can be enabled
    chkAutoBid.disabled =  !activateAutoBidButton(row.articleMaxBid, row.articleMinimumBid, row.articleBidPrice);
    // if the maxBid is < minimum bidding price or current Price, add highlight color
    if (chkAutoBid.disabled) {
      inpMaxBid.classList.add('bomHighlightBorder');
    } else {
      inpMaxBid.classList.remove('bomHighlightBorder');
    }

    // disable maxBid/autoBid if article ended
    if (row.articleEndTime - Date.now() <= 0) {
      //console.debug("Biet-O-Matic: Article %s already ended, disabling inputs", row.articleId);
      inpMaxBid.disabled = true;
      chkAutoBid.disabled = true;
    }
    divArticleMaxBid.appendChild(inpMaxBid);
    divArticleMaxBid.appendChild(labelAutoBid);
    return divArticleMaxBid.outerHTML;
  }

  // render the log data for the specified article
  // returns the HTML content
  function renderArticleLog(data) {
    if (!data.hasOwnProperty('articleId')) return "";
    let div = document.createElement('div');
    let table = document.createElement('table');
    table.style.paddingLeft = '50px';
    // get log entries
    let log = getArticleLog(data.articleId);
    if (log == null) return "";
    log.forEach(e => {
      let tr = document.createElement('tr');
      let tdDate = document.createElement('td');
      if (e.hasOwnProperty('timestamp'))
        tdDate.textContent = moment(e.timestamp).format();
      else
        tdDate.textContent = '?';
      tr.append(tdDate);
      let tdComp = document.createElement('td');
      if (e.hasOwnProperty('component'))
        tdComp.textContent = e.component;
      else
        tdComp.textContent = '?';
      tr.append(tdComp);
      let tdLevel = document.createElement('td');
      if (e.hasOwnProperty('level'))
        tdLevel.textContent = e.level;
      else
        tdLevel.textContent = '?';
      tr.append(tdLevel);
      let tdMsg = document.createElement('td');
      if (e.hasOwnProperty('level'))
        tdMsg.textContent = e.message;
      else
        tdMsg.textContent = 'n/a';
      tr.append(tdMsg);
      table.appendChild(tr);
    });
    div.appendChild(table);
    return div.innerHTML;
  }

  /*
   * MAIN
   */

    document.addEventListener('DOMContentLoaded', function () {
      detectWhoIAm().then(whoIAm => {
        pt.whoIAm = whoIAm;
        registerEvents();
        // restore settings from session storage (autoBidEnabled, bidAllEnabled)
        restoreSettings();
        updateFavicon($('#inpAutoBid').is(':checked'));

        pt.table = $('#articles').DataTable({
          columns: [
            {
              className: 'details-control',
              orderable: false,
              data: null,
              width: '15px',
              defaultContent: '',
              "render": function (data, type, row) {
                if (getArticleLog(row.articleId) != null)
                  return '<i class="ui-icon ui-icon-plus" aria-hidden="true"></i>';
                else
                  return '';
              },
            },
            {
              name: 'articleId',
              data: 'articleId',
              visible: true,
              width: '100px',
              render: function (data, type, row) {
                if (type !== 'display' && type !== 'filter') return data;
                let div = document.createElement("div");
                div.id = data;
                let a = document.createElement('a');
                a.href = 'https://cgi.ebay.de/ws/eBayISAPI.dll?ViewItem&item=' + row.articleId;
                a.id = 'tabid:' + row.tabId;
                a.text = data;
                div.appendChild(a);
                return div.outerHTML;
              }
            },
            {
              name: 'articleDescription',
              data: 'articleDescription',
              render: $.fn.dataTable.render.ellipsis(100, true, false),
              defaultContent: 'Unbekannt'
            },
            {
              name: 'articleEndTime',
              data: 'articleEndTime',
              render: function (data, type, row) {
                if (typeof data !== 'undefined') {
                  if (type !== 'display' && type !== 'filter') return data;
                  let timeLeft = moment(data);  // jshint ignore:line
                  moment.relativeTimeThreshold('ss', 0);
                  timeLeft.locale('de');
                  return `${fixDate({articleEndTime: data})} (${timeLeft.fromNow()})`;
                } else {
                  return "unbegrenzt";
                }
              },
              defaultContent: '?'
            },
            {
              name: 'articleBidPrice',
              data: 'articleBidPrice',
              defaultContent: 0,
              render: renderArticleBidPrice
            },
            {
              name: 'articleShippingCost',
              data: 'articleShippingCost',
              defaultContent: '0.00'
            },
            {
              name: 'articleAuctionState',
              data: 'articleAuctionState',
              defaultContent: ''
            },
            {
              name: 'articleAutoBid',
              data: 'articleAutoBid',
              visible: false,
              defaultContent: "false"
            },
            {
              name: 'articleMaxBid',
              data: 'articleMaxBid',
              render: renderArticleMaxBid,
              defaultContent: 0
            }
          ],
          order: [[3, "asc"]],
          columnDefs: [
            {searchable: false, "orderable": false, targets: [6, 7, 8]},
            {type: "num", targets: [1, 8]},
            {className: "dt-body-center dt-body-nowrap", targets: [0, 1, 8]},
            {width: "100px", targets: [4, 5, 7, 8]},
            {width: "220px", targets: [3]},
            {width: "300px", targets: [2, 6]}
          ],
          searchDelay: 400,
          rowId: 'tabId',
          pageLength: 25,
          language:
          //"url": "https://cdn.datatables.net/plug-ins/1.10.20/i18n/German.json"
            {
              "sEmptyTable": "Keine Daten in der Tabelle vorhanden",
              "sInfo": "_START_ bis _END_ von _TOTAL_ Einträgen",
              "sInfoEmpty": "Keine Daten vorhanden",
              "sInfoFiltered": "(gefiltert von _MAX_ Einträgen)",
              "sInfoPostFix": "",
              "sInfoThousands": ".",
              "sLengthMenu": "_MENU_ Einträge anzeigen",
              "sLoadingRecords": "Wird geladen ..",
              "sProcessing": "Bitte warten ..",
              "sSearch": "Suchen",
              "sZeroRecords": "Keine Einträge vorhanden",
              "oPaginate": {
                "sFirst": "Erste",
                "sPrevious": "Zurück",
                "sNext": "Nächste",
                "sLast": "Letzte"
              },
              "oAria": {
                "sSortAscending": ": aktivieren, um Spalte aufsteigend zu sortieren",
                "sSortDescending": ": aktivieren, um Spalte absteigend zu sortieren"
              },
              "select": {
                "rows": {
                  "_": "%d Zeilen ausgewählt",
                  "0": "",
                  "1": "1 Zeile ausgewählt"
                }
              },
              "buttons": {
                "print": "Drucken",
                "colvis": "Spalten",
                "copy": "Kopieren",
                "copyTitle": "In Zwischenablage kopieren",
                "copyKeys": "Taste <i>ctrl</i> oder <i>\u2318</i> + <i>C</i> um Tabelle<br>in Zwischenspeicher zu kopieren.<br><br>Um abzubrechen die Nachricht anklicken oder Escape drücken.",
                "copySuccess": {
                  "_": "%d Zeilen kopiert",
                  "1": "1 Zeile kopiert"
                },
                "pageLength": {
                  "-1": "Zeige alle Zeilen",
                  "_": "Zeige %d Zeilen"
                }
              }
            }
        });
        // initialize tabs
        pt.whoIAm.currentWindow.tabs.forEach((tab) => {
          getArticleInfoForTab(tab)
            .then(articleInfo => {
              if (articleInfo.hasOwnProperty('detail')) {
                addOrUpdateArticle(tab, articleInfo.detail)
                  .catch(e => {
                    console.debug("Biet-O-Matic: addOrUpdateArticle() failed - %s", e.toString());
                  });
              }
            })
            .catch(e => {
              console.warn("Biet-O-Matic: Failed to get Article Info from Tab %d: %s", tab.id, e.message);
            });
        });

        configureUi();
        checkBrowserStorage();
        console.debug("DOMContentLoaded handler for window with id = %d completed (%O).", pt.whoIAm.currentWindow.id, pt.whoIAm.currentWindow);
        pt.whoIAm.currentWindow.helloFromBom = "Date: " + moment().format();
      }).catch((err) => {
        console.error("Biet-O-Matic:; DOMContentLoaded post initialisation failed; %s", err);
      });
    });
};

popup();