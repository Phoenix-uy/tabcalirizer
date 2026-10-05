// TabCalirizer — browser window script (chrome://browser/content/browser.xhtml).
// Paints tabs by domain rule, draws the content-area border and adds the
// toolbar button + tab context menu.
(() => {
  if (window.__tabCalirizerLoaded) {
    return;
  }
  window.__tabCalirizerLoaded = true;

  const LOG = "[TabCalirizer]";
  const HTML_NS = "http://www.w3.org/1999/xhtml";
  const STORE_URL = "chrome://sine/content/tabcalirizer/tabcalirizer-store.sys.mjs";
  const BUTTON_ID = "tabcalirizer-button";
  const PREFS_PANE = "paneTabCalirizer";

  // Zen/Firefox selectors in one place, so they are easy to fix after a Zen update.
  const SEL = {
    pageContainer: ".browserSidebarContainer",
    tabContextMenu: "#tabContextMenu",
    tabContextAnchor: "#context_moveTabOptions, #context_pinTab, #context_duplicateTab",
  };

  // Tab attributes and CSS custom properties this script sets (all removed on unload).
  const ATTR = { on: "tcz", style: "tcz-tab-style", border: "tcz-border-pos" };
  const VARS = ["--tcz-color", "--tcz-fg"];
  const PAGE_BORDER_CLASS = "tcz-page-border";
  const PAGE_LABEL_CLASS = "tcz-page-label";
  const RELATIVE_ATTR = "tcz-relative";

  let T; // store module
  const cleanups = [];
  const onCleanup = (fn) => cleanups.push(fn);

  function warnOnce(key, ...args) {
    warnOnce.seen ??= new Set();
    if (!warnOnce.seen.has(key)) {
      warnOnce.seen.add(key);
      console.warn(LOG, ...args);
    }
  }

  /* ---------- Painting ---------- */

  function ruleForTab(tab) {
    const data = T.Store.data;
    if (!data) {
      return null;
    }
    const host = T.hostOfURI(tab.linkedBrowser?.currentURI);
    return host ? T.matchHost(data.rules, host) : null;
  }

  function clearTab(tab) {
    for (const a of Object.values(ATTR)) {
      tab.removeAttribute(a);
    }
    for (const v of VARS) {
      tab.style.removeProperty(v);
    }
  }

  function paintTab(tab) {
    try {
      const rule = ruleForTab(tab);
      if (!rule) {
        clearTab(tab);
      } else {
        tab.setAttribute(ATTR.on, "true");
        tab.setAttribute(ATTR.style, rule.tabStyle);
        tab.setAttribute(ATTR.border, rule.borderPosition);
        tab.style.setProperty("--tcz-color", rule.color);
        tab.style.setProperty("--tcz-fg", T.contrastText(rule.color));
      }
      paintPageBorder(tab, rule);
    } catch (err) {
      warnOnce("paintTab", "Failed to paint a tab:", err);
    }
  }

  function pageContainerFor(tab) {
    const browser = tab.linkedBrowser;
    if (!browser?.isConnected || typeof browser.closest !== "function") {
      return null; // lazy / unloaded tab: painted again once its browser is inserted
    }
    return browser.closest(SEL.pageContainer);
  }

  function paintPageBorder(tab, rule) {
    const container = pageContainerFor(tab);
    if (!container) {
      return;
    }
    let overlay = container.querySelector(`:scope > .${PAGE_BORDER_CLASS}`);
    if (!rule?.pageBorder.enabled) {
      overlay?.remove();
      container.removeAttribute(RELATIVE_ATTR);
      return;
    }
    if (!overlay) {
      overlay = document.createElementNS(HTML_NS, "div");
      overlay.className = PAGE_BORDER_CLASS;
      overlay.setAttribute("aria-hidden", "true");
      container.append(overlay);
    }
    // Only force a positioning context when Zen hasn't given one (e.g. never touch Glance overlays).
    if (!container.hasAttribute(RELATIVE_ATTR) && getComputedStyle(container).position === "static") {
      container.setAttribute(RELATIVE_ATTR, "true");
    }
    const { width, style, showTitle } = rule.pageBorder;
    overlay.style.setProperty("--tcz-color", rule.color);
    overlay.style.setProperty("--tcz-fg", T.contrastText(rule.color));
    overlay.style.setProperty("--tcz-page-width", `${width}px`);
    overlay.style.setProperty("--tcz-page-style", style);

    // Optional title: a small, semi-transparent tag centered on the top edge of the frame.
    let label = overlay.querySelector(`:scope > .${PAGE_LABEL_CLASS}`);
    if (showTitle && rule.title) {
      if (!label) {
        label = document.createElementNS(HTML_NS, "span");
        label.className = PAGE_LABEL_CLASS;
        overlay.append(label);
      }
      label.textContent = rule.title;
    } else {
      label?.remove();
    }
  }

  function paintAll() {
    for (const tab of gBrowser.tabs) {
      paintTab(tab);
    }
  }

  // Coalesce bursts of events (session restore fires many) into one paint per tab per frame.
  const pending = new Set();
  let frame = 0;
  function schedule(tab) {
    if (!tab) {
      return;
    }
    pending.add(tab);
    if (!frame) {
      frame = requestAnimationFrame(() => {
        frame = 0;
        for (const t of pending) {
          if (t.isConnected) {
            paintTab(t);
          }
        }
        pending.clear();
      });
    }
  }

  /* ---------- Listeners ---------- */

  function addTabListeners() {
    const container = gBrowser.tabContainer;
    const onTabEvent = (e) => schedule(e.target);
    const events = ["TabOpen", "TabBrowserInserted", "SSTabRestoring", "SSTabRestored", "TabAttrModified"];
    for (const ev of events) {
      container.addEventListener(ev, onTabEvent);
    }
    onCleanup(() => events.forEach((ev) => container.removeEventListener(ev, onTabEvent)));

    const progressListener = {
      onLocationChange(browser, webProgress) {
        if (webProgress?.isTopLevel) {
          schedule(gBrowser.getTabForBrowser(browser));
        }
      },
    };
    gBrowser.addTabsProgressListener(progressListener);
    onCleanup(() => gBrowser.removeTabsProgressListener(progressListener));

    // Split view / workspace switches move browsers between containers; repaint borders.
    const onSelect = () => paintAll();
    container.addEventListener("TabSelect", onSelect);
    window.addEventListener("ZenWorkspacesUIUpdate", onSelect);
    onCleanup(() => {
      container.removeEventListener("TabSelect", onSelect);
      window.removeEventListener("ZenWorkspacesUIUpdate", onSelect);
    });

    const observer = { observe: () => paintAll() };
    Services.obs.addObserver(observer, T.TOPIC);
    onCleanup(() => Services.obs.removeObserver(observer, T.TOPIC));
  }

  /* ---------- Settings / quick actions ---------- */

  function openSettings(draft = null) {
    T.Store.pendingDraft = draft;
    // Reuse an open settings tab when there is one.
    for (const tab of gBrowser.tabs) {
      const spec = tab.linkedBrowser?.currentURI?.spec ?? "";
      if (spec.startsWith("about:preferences") || spec.startsWith("about:settings")) {
        gBrowser.selectedTab = tab;
        Services.obs.notifyObservers(null, "tabcalirizer:open-settings");
        return;
      }
    }
    window.openPreferences(PREFS_PANE);
  }

  function addToolbarButton() {
    const { CustomizableUI } = ChromeUtils.importESModule("resource:///modules/CustomizableUI.sys.mjs");
    if (!CustomizableUI.getWidget(BUTTON_ID)?.instances?.length) {
      try {
        CustomizableUI.createWidget({
          id: BUTTON_ID,
          type: "button",
          label: "TabCalirizer",
          tooltiptext: "TabCalirizer: color this site",
          defaultArea: CustomizableUI.AREA_NAVBAR,
          onCommand(event) {
            const win = event.target.ownerGlobal;
            win.TabCalirizer?.colorCurrentSite();
          },
        });
      } catch (err) {
        // Already created by another window.
        if (!String(err).includes("already")) {
          warnOnce("widget", "Could not create toolbar button:", err);
        }
      }
    }
    onCleanup(() => {
      // Destroy only when the last window unloads the mod.
      if (![...Services.wm.getEnumerator("navigator:browser")].some((w) => w !== window && w.__tabCalirizerLoaded)) {
        try {
          CustomizableUI.destroyWidget(BUTTON_ID);
        } catch {}
      }
    });
  }

  function draftForTab(tab, scope) {
    const host = T.hostOfURI(tab?.linkedBrowser?.currentURI);
    if (!host) {
      return null;
    }
    const existing = T.matchHost(T.Store.data?.rules ?? [], host);
    if (scope === "match" && existing) {
      return { ...existing };
    }
    if (scope === "base") {
      return { sites: [{ pattern: T.baseDomainOf(host), type: "wildcard" }] };
    }
    return { sites: [{ pattern: host, type: "exact" }] };
  }

  function colorCurrentSite() {
    openSettings(draftForTab(gBrowser.selectedTab, "match"));
  }

  function buildContextMenu() {
    const menu = document.querySelector(SEL.tabContextMenu);
    if (!menu) {
      warnOnce("ctx", "Tab context menu not found; quick actions disabled.");
      return;
    }
    const fragment = window.MozXULElement.parseXULToFragment(`
      <menuseparator id="tcz-ctx-sep"/>
      <menu id="tcz-ctx-menu" label="TabCalirizer">
        <menupopup id="tcz-ctx-popup"/>
      </menu>
    `);
    const anchor = menu.querySelector(SEL.tabContextAnchor);
    if (anchor) {
      anchor.before(fragment);
    } else {
      menu.append(fragment);
    }
    const menuEl = document.getElementById("tcz-ctx-menu");
    const sepEl = document.getElementById("tcz-ctx-sep");
    const popup = document.getElementById("tcz-ctx-popup");

    const onShowing = () => {
      const tab = window.TabContextMenu?.contextTab ?? gBrowser.selectedTab;
      const host = T.hostOfURI(tab?.linkedBrowser?.currentURI);
      menuEl.hidden = sepEl.hidden = !host;
    };
    menu.addEventListener("popupshowing", onShowing);

    popup.addEventListener("popupshowing", (e) => {
      if (e.target !== popup) {
        return;
      }
      const tab = window.TabContextMenu?.contextTab ?? gBrowser.selectedTab;
      const host = T.hostOfURI(tab?.linkedBrowser?.currentURI);
      popup.replaceChildren();
      if (!host) {
        return;
      }
      const base = T.baseDomainOf(host);
      const data = T.Store.data ?? { rules: [], palette: [] };
      const current = T.matchHost(data.rules, host);

      const addItem = (parent, label, onCommand, extra = {}) => {
        const item = document.createXULElement("menuitem");
        item.setAttribute("label", label);
        for (const [k, v] of Object.entries(extra)) {
          item.setAttribute(k, v);
        }
        item.addEventListener("command", onCommand);
        parent.append(item);
        return item;
      };

      const addColorSubmenu = (label, pattern, type) => {
        const sub = document.createXULElement("menu");
        sub.setAttribute("label", label);
        const subPopup = document.createXULElement("menupopup");
        for (const color of data.palette) {
          const item = addItem(subPopup, color, () => {
            // If a rule already lists this site, recolor that rule (keeping its other sites).
            const key = T.siteKey({ pattern, type });
            const owner = data.rules.find((r) => r.sites.some((site) => T.siteKey(site) === key));
            T.Store.upsertRule(owner ? { ...owner, color } : { sites: [{ pattern, type }], color });
          });
          item.classList.add("menuitem-iconic", "tcz-swatch-item");
          item.style.setProperty("--tcz-color", color);
        }
        if (!data.palette.length) {
          addItem(subPopup, "No saved colors yet", () => {}, { disabled: "true" });
        }
        sub.append(subPopup);
        popup.append(sub);
      };

      addColorSubmenu(`Color ${host}`, host, "exact");
      if (base && base !== host) {
        addColorSubmenu(`Color *.${base}`, base, "wildcard");
      } else {
        addColorSubmenu(`Color ${host} and subdomains`, host, "wildcard");
      }
      popup.append(document.createXULElement("menuseparator"));
      addItem(popup, "Color this site…", () => openSettings(draftForTab(tab, "match")));
      if (current) {
        const name =
          current.title || current.sites.map(T.displaySite).join(", ").replace(/^(.{40}).+$/, "$1…");
        addItem(popup, `Remove rule (${name})`, () =>
          T.Store.removeRule(current.id)
        );
      }
      addItem(popup, "Open TabCalirizer settings", () => openSettings());
    });

    onCleanup(() => {
      menu.removeEventListener("popupshowing", onShowing);
      menuEl.remove();
      sepEl.remove();
    });
  }

  /* ---------- Lifecycle ---------- */

  function teardown() {
    for (const fn of cleanups.splice(0).reverse()) {
      try {
        fn();
      } catch (err) {
        console.warn(LOG, "Cleanup step failed:", err);
      }
    }
    if (frame) {
      cancelAnimationFrame(frame);
    }
    for (const tab of gBrowser.tabs) {
      clearTab(tab);
    }
    for (const el of document.querySelectorAll(`.${PAGE_BORDER_CLASS}`)) {
      el.remove();
    }
    for (const el of document.querySelectorAll(`[${RELATIVE_ATTR}]`)) {
      el.removeAttribute(RELATIVE_ATTR);
    }
    delete window.TabCalirizer;
    delete window.__tabCalirizerLoaded;
  }

  async function init() {
    try {
      T = ChromeUtils.importESModule(STORE_URL);
    } catch (err) {
      console.error(LOG, `Could not load ${STORE_URL}. Is the mod installed with id "tabcalirizer"?`, err);
      return;
    }
    await T.Store.load();

    window.TabCalirizer = { colorCurrentSite, openSettings, repaint: paintAll };

    addTabListeners();
    buildContextMenu();
    addToolbarButton();
    paintAll();

    if (typeof window.addUnloadListener === "function") {
      window.addUnloadListener(teardown);
    }
    console.info(LOG, "Loaded.");
  }

  const start = () => init().catch((err) => console.error(LOG, "Init failed:", err));
  if (window.gBrowserInit?.delayedStartupFinished) {
    start();
  } else {
    const obs = (subject, topic) => {
      if (topic === "browser-delayed-startup-finished" && subject === window) {
        Services.obs.removeObserver(obs, topic);
        start();
      }
    };
    Services.obs.addObserver(obs, "browser-delayed-startup-finished");
  }
})();
