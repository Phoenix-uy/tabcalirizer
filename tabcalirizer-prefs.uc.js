// TabCalirizer — settings pane injected into Zen's settings page (about:preferences).
(() => {
  if (window.__tabCalirizerPrefsLoaded) {
    return;
  }
  if (typeof window.gCategoryInits === "undefined" || !document.querySelector("#categories")) {
    return; // not the main settings page (e.g. a sub-dialog)
  }
  window.__tabCalirizerPrefsLoaded = true;

  const LOG = "[TabCalirizer:Settings]";
  const HTML_NS = "http://www.w3.org/1999/xhtml";
  const BASE_URL = "chrome://sine/content/tabcalirizer/";
  const PANE = "paneTabCalirizer";
  const HASH = "#tabcalirizer";
  const ICON =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect x='1' y='3' width='6' height='4' rx='1.5' fill='%23e53935'/%3E%3Crect x='9' y='3' width='6' height='4' rx='1.5' fill='%231e88e5'/%3E%3Crect x='1' y='9' width='6' height='4' rx='1.5' fill='%2343a047'/%3E%3Crect x='9' y='9' width='6' height='4' rx='1.5' fill='%23fb8c00'/%3E%3C/svg%3E";

  let T;
  const injected = [];
  const cleanups = [];

  /* ---------- Tiny DOM helper ---------- */

  function h(tag, props = {}, ...children) {
    const el = document.createElementNS(HTML_NS, tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) {
        continue;
      }
      if (k === "class") {
        el.className = v;
      } else if (k === "text") {
        el.textContent = v;
      } else if (k.startsWith("on")) {
        el.addEventListener(k.slice(2), v);
      } else if (k === "style" && typeof v === "object") {
        for (const [p, val] of Object.entries(v)) {
          el.style.setProperty(p, val);
        }
      } else {
        el.setAttribute(k, v === true ? "" : v);
      }
    }
    el.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
    return el;
  }

  function options(select, map, value) {
    select.replaceChildren(...Object.entries(map).map(([k, label]) => h("option", { value: k, text: label })));
    select.value = value;
    return select;
  }

  const SHORT_TYPE = { exact: "exact", wildcard: "+ subdomains", base: "base domain" };

  /* ---------- Navigation entry ---------- */

  function addCategory() {
    const categories = document.querySelector("#categories");
    const general = categories.querySelector("#category-general");
    const after = categories.querySelector("#category-sine-mods") ?? general;
    let item;
    if (general?.localName === "moz-page-nav-button") {
      item = document.createElementNS(HTML_NS, "moz-page-nav-button");
      item.setAttribute("view", PANE);
      item.setAttribute("iconsrc", ICON);
      item.textContent = "TabCalirizer";
    } else {
      item = window.MozXULElement.parseXULToFragment(`
        <richlistitem class="category" value="${PANE}" align="center" tooltiptext="TabCalirizer">
          <image class="category-icon"/>
          <label class="category-name" flex="1" value="TabCalirizer"/>
        </richlistitem>`).firstElementChild;
      item.querySelector(".category-icon").style.listStyleImage = `url("${ICON}")`;
    }
    item.id = "category-tabcalirizer";
    after.after(item);
    injected.push(item);

    window.gCategoryInits.set(PANE, { _initted: true, init() {} });
    cleanups.push(() => window.gCategoryInits.delete(PANE));
  }

  function showPane() {
    try {
      window.gotoPref(PANE);
    } catch (err) {
      console.warn(LOG, "gotoPref failed:", err);
    }
  }

  /* ---------- Pane skeleton ---------- */

  const ui = {};

  function groupbox(id, title, description, ...content) {
    const box = document.createXULElement("groupbox");
    box.id = id;
    box.className = "highlighting-group subcategory tcz-group";
    box.setAttribute("data-category", PANE);
    box.setAttribute("hidden", "true");
    box.append(
      h("h2", { text: title }),
      description ? h("p", { class: "description-deemphasized tcz-desc", text: description }) : null,
      ...content
    );
    return box;
  }

  function buildPane() {
    const prefPane = document.querySelector("#mainPrefPane") ?? document.querySelector("#paneDeck");
    if (!prefPane) {
      throw new Error("Settings pane container not found");
    }

    const header = document.createXULElement("hbox");
    header.className = "subcategory";
    header.setAttribute("data-category", PANE);
    header.setAttribute("hidden", "true");
    header.append(h("h1", { text: "TabCalirizer" }));

    // Rules
    ui.testInput = h("input", {
      type: "text",
      class: "tcz-input",
      placeholder: "Test a host, e.g. mail.google.com",
      oninput: renderTest,
    });
    ui.testResult = h("span", { class: "tcz-test-result" });
    ui.ruleList = h("div", { class: "tcz-rule-list" });
    ui.editor = buildEditor();
    const rulesBox = groupbox(
      "tcz-rules-group",
      "Rules",
      "Color tabs by site. When several rules match, the most specific one wins (mail.google.com beats *.google.com).",
      h("div", { class: "tcz-row" }, h("button", { class: "tcz-primary", text: "Add rule", onclick: () => openEditor() })),
      ui.editor,
      ui.ruleList,
      h("div", { class: "tcz-row tcz-test" }, ui.testInput, ui.testResult)
    );

    // Palette
    ui.paletteList = h("div", { class: "tcz-palette" });
    ui.paletteColor = h("input", { type: "color", value: "#1e88e5", class: "tcz-color" });
    ui.paletteHex = h("input", { type: "text", class: "tcz-input tcz-hex", value: "#1e88e5", maxlength: "7" });
    linkColorInputs(ui.paletteColor, ui.paletteHex);
    ui.paletteError = h("span", { class: "tcz-error" });
    const paletteBox = groupbox(
      "tcz-palette-group",
      "Saved colors",
      "Colors saved here appear in the rule editor and in the tab context menu (right-click a tab → TabCalirizer).",
      ui.paletteList,
      h(
        "div",
        { class: "tcz-row" },
        ui.paletteColor,
        ui.paletteHex,
        h("button", { text: "Save color", onclick: savePaletteColor }),
        ui.paletteError
      )
    );

    // Import / export
    ui.replaceCheck = h("input", { type: "checkbox", id: "tcz-replace" });
    ui.ioStatus = h("span", { class: "tcz-status" });
    const ioBox = groupbox(
      "tcz-io-group",
      "Import / export",
      "Back up your rules and colors as JSON, or move them to another profile.",
      h(
        "div",
        { class: "tcz-row" },
        h("button", { text: "Export to file…", onclick: exportToFile }),
        h("button", { text: "Copy JSON", onclick: copyJSON }),
        h("button", { text: "Import from file…", onclick: importFromFile }),
        h("label", { class: "tcz-inline", for: "tcz-replace" }, ui.replaceCheck, "Replace existing data on import")
      ),
      ui.ioStatus
    );

    // Insert after the General pane's elements, like other custom panes do.
    const anchor = prefPane.querySelector('[data-category="paneGeneral"]');
    const nodes = [header, rulesBox, paletteBox, ioBox];
    if (anchor) {
      anchor.before(...nodes);
    } else {
      prefPane.append(...nodes);
    }
    injected.push(...nodes);
  }

  /* ---------- Color inputs ---------- */

  function linkColorInputs(colorInput, hexInput, onChange = () => {}) {
    colorInput.addEventListener("input", () => {
      hexInput.value = colorInput.value;
      hexInput.classList.remove("tcz-invalid");
      onChange(colorInput.value);
    });
    hexInput.addEventListener("input", () => {
      let v = hexInput.value.trim();
      if (v && !v.startsWith("#")) {
        v = `#${v}`;
      }
      const ok = T.isValidHex(v);
      hexInput.classList.toggle("tcz-invalid", !ok && v.length > 0);
      if (ok) {
        colorInput.value = v.toLowerCase();
        onChange(colorInput.value);
      }
    });
  }

  function readHex(hexInput) {
    let v = hexInput.value.trim();
    if (v && !v.startsWith("#")) {
      v = `#${v}`;
    }
    return T.normalizeHex(v);
  }

  /* ---------- Rule editor ---------- */

  function buildEditor() {
    const e = (ui.ed = {});
    e.title = h("input", {
      type: "text",
      class: "tcz-input tcz-wide",
      placeholder: "Optional, e.g. Work mail",
      maxlength: String(T.TITLE_MAX),
    });
    e.siteRows = [];
    e.sitesBox = h("div", { class: "tcz-sites" });
    e.addSiteBtn = h("button", { class: "tcz-small", text: "+ Add site", onclick: () => addSiteRow(null, true) });
    e.color = h("input", { type: "color", class: "tcz-color", value: "#1e88e5" });
    e.hex = h("input", { type: "text", class: "tcz-input tcz-hex", value: "#1e88e5", maxlength: "7" });
    e.swatches = h("div", { class: "tcz-palette tcz-palette-small" });
    e.tabStyle = options(h("select", { class: "tcz-select" }), T.TAB_STYLES, "background");
    e.borderPos = options(h("select", { class: "tcz-select" }), T.BORDER_POSITIONS, "left");
    e.borderPosRow = h("div", { class: "tcz-field" }, h("label", { text: "Tab border" }), e.borderPos);
    e.pageOn = h("input", { type: "checkbox", id: "tcz-page-on" });
    e.pageWidth = h("input", {
      type: "range",
      min: String(T.PAGE_BORDER_MIN),
      max: String(T.PAGE_BORDER_MAX),
      value: "3",
      class: "tcz-range",
    });
    e.pageWidthNum = h("input", {
      type: "number",
      min: String(T.PAGE_BORDER_MIN),
      max: String(T.PAGE_BORDER_MAX),
      value: "3",
      class: "tcz-input tcz-num",
    });
    e.pageStyle = options(h("select", { class: "tcz-select" }), T.PAGE_BORDER_STYLES, "solid");
    e.showTitle = h("input", { type: "checkbox", id: "tcz-show-title" });
    e.showTitleHint = h("span", { class: "description-deemphasized" });
    e.showTitleRow = h(
      "div",
      { class: "tcz-field tcz-indent" },
      h("label", { class: "tcz-inline", for: "tcz-show-title" }, e.showTitle, "Show the title on the page border"),
      e.showTitleHint
    );
    e.pageDetails = h(
      "div",
      { class: "tcz-field tcz-indent" },
      h("label", { text: "Thickness" }),
      e.pageWidth,
      e.pageWidthNum,
      h("span", { text: "px" }),
      e.pageStyle
    );
    e.error = h("div", { class: "tcz-error" });
    e.preview = buildPreview();

    linkColorInputs(e.color, e.hex, updatePreview);
    e.title.addEventListener("input", updatePreview);
    for (const el of [e.tabStyle, e.borderPos, e.pageOn, e.pageStyle, e.showTitle]) {
      el.addEventListener("change", updatePreview);
    }
    e.pageWidth.addEventListener("input", () => {
      e.pageWidthNum.value = e.pageWidth.value;
      updatePreview();
    });
    e.pageWidthNum.addEventListener("input", () => {
      e.pageWidth.value = e.pageWidthNum.value;
      updatePreview();
    });

    return h(
      "div",
      { class: "tcz-editor", hidden: true },
      h("h3", { class: "tcz-editor-title", text: "New rule" }),
      h("div", { class: "tcz-field" }, h("label", { text: "Title" }), e.title),
      h("div", { class: "tcz-field tcz-field-top" }, h("label", { text: "Sites" }), e.sitesBox),
      h(
        "div",
        { class: "tcz-field tcz-indent" },
        e.addSiteBtn,
        h("span", {
          class: "description-deemphasized",
          text: "Tip: paste several hosts or URLs at once (one per line or comma-separated).",
        })
      ),
      h(
        "div",
        { class: "tcz-field" },
        h("label", { text: "Color" }),
        e.color,
        e.hex,
        h("button", { class: "tcz-small", text: "Save to palette", onclick: () => saveColorFrom(e.hex) })
      ),
      h("div", { class: "tcz-field tcz-indent" }, e.swatches),
      h("div", { class: "tcz-field" }, h("label", { text: "Tab style" }), e.tabStyle),
      e.borderPosRow,
      h(
        "div",
        { class: "tcz-field" },
        h("label", { class: "tcz-inline", for: "tcz-page-on" }, e.pageOn, "Draw a border around the page")
      ),
      e.pageDetails,
      e.showTitleRow,
      e.preview.root,
      e.error,
      h(
        "div",
        { class: "tcz-row" },
        h("button", { class: "tcz-primary", text: "Save rule", onclick: saveRule }),
        h("button", { text: "Cancel", onclick: closeEditor })
      )
    );
  }

  function addSiteRow(site = null, focus = false, insertAfter = null) {
    const e = ui.ed;
    const row = {};
    row.input = h("input", {
      type: "text",
      class: "tcz-input tcz-wide",
      placeholder: "dev.example.com, *.example.com or a URL",
    });
    row.type = options(h("select", { class: "tcz-select" }), T.MATCH_TYPES, site?.type in T.MATCH_TYPES ? site.type : "exact");
    row.input.value = site ? T.displaySite(site) : "";
    row.remove = h("button", {
      class: "tcz-icon-btn",
      title: "Remove this site",
      text: "×",
      onclick: () => {
        if (e.siteRows.length > 1) {
          e.siteRows.splice(e.siteRows.indexOf(row), 1);
          row.el.remove();
        } else {
          row.input.value = "";
        }
        updateSiteRows();
      },
    });
    row.input.addEventListener("input", () => {
      // Typing "*.example.com" switches the match type automatically.
      if (row.input.value.trim().startsWith("*.")) {
        row.type.value = "wildcard";
      }
      row.input.classList.remove("tcz-invalid");
    });
    row.input.addEventListener("paste", (ev) => {
      const text = ev.clipboardData?.getData("text/plain") ?? "";
      const parts = text.split(/[\s,;]+/).filter(Boolean);
      if (parts.length < 2) {
        return;
      }
      ev.preventDefault();
      row.input.value = parts[0];
      row.input.dispatchEvent(new Event("input"));
      let after = row;
      for (const part of parts.slice(1)) {
        after = addSiteRow(null, false, after);
        after.input.value = part;
        after.input.dispatchEvent(new Event("input"));
      }
    });
    row.el = h("div", { class: "tcz-site-row" }, row.input, row.type, row.remove);
    if (insertAfter) {
      insertAfter.el.after(row.el);
      e.siteRows.splice(e.siteRows.indexOf(insertAfter) + 1, 0, row);
    } else {
      e.sitesBox.append(row.el);
      e.siteRows.push(row);
    }
    updateSiteRows();
    if (focus) {
      row.input.focus();
    }
    return row;
  }

  function updateSiteRows() {
    const e = ui.ed;
    e.addSiteBtn.disabled = e.siteRows.length >= T.SITES_MAX;
  }

  function setSiteRows(sites) {
    const e = ui.ed;
    e.siteRows = [];
    e.sitesBox.replaceChildren();
    for (const site of sites.length ? sites : [null]) {
      addSiteRow(site);
    }
  }

  function buildPreview() {
    const p = {};
    p.inactive = h("div", { class: "tcz-pv-tab" }, h("span", { class: "tcz-pv-dot" }), h("span", { text: "Inactive tab" }));
    p.active = h(
      "div",
      { class: "tcz-pv-tab tcz-pv-selected" },
      h("span", { class: "tcz-pv-dot" }),
      h("span", { text: "Selected tab" })
    );
    p.label = h("span", { class: "tcz-pv-label", hidden: true });
    p.page = h("div", { class: "tcz-pv-page" }, h("span", { text: "Web page" }), p.label);
    p.root = h(
      "div",
      { class: "tcz-preview" },
      h("div", { class: "tcz-pv-sidebar" }, p.inactive, p.active, h("div", { class: "tcz-pv-tab tcz-pv-plain", text: "Other site" })),
      p.page
    );
    return p;
  }

  function editorValues() {
    const e = ui.ed;
    return {
      id: ui.editingId ?? undefined,
      title: e.title.value,
      sites: e.siteRows
        .filter((r) => r.input.value.trim())
        .map((r) => ({ pattern: r.input.value, type: r.type.value, row: r })),
      color: readHex(e.hex),
      tabStyle: e.tabStyle.value,
      borderPosition: e.borderPos.value,
      pageBorder: {
        enabled: e.pageOn.checked,
        width: e.pageWidthNum.value,
        style: e.pageStyle.value,
        showTitle: e.showTitle.checked,
      },
    };
  }

  function updatePreview() {
    const e = ui.ed;
    const v = editorValues();
    const color = v.color ?? e.color.value;
    const fg = T.contrastText(color);
    const hasBorder = v.tabStyle !== "background";
    e.borderPosRow.hidden = !hasBorder;
    e.pageDetails.hidden = !v.pageBorder.enabled;
    e.showTitleRow.hidden = !v.pageBorder.enabled;
    const title = v.title.trim();
    e.showTitleHint.textContent = title ? "" : "(add a title above)";
    const showLabel = v.pageBorder.enabled && v.pageBorder.showTitle && Boolean(title);
    e.preview.label.hidden = !showLabel;
    e.preview.label.textContent = title;
    e.preview.label.style.setProperty("--tcz-color", color);
    e.preview.label.style.setProperty("--tcz-fg", fg);
    for (const tab of [e.preview.inactive, e.preview.active]) {
      tab.style.setProperty("--tcz-color", color);
      tab.style.setProperty("--tcz-fg", fg);
      tab.setAttribute("data-style", v.tabStyle);
      tab.setAttribute("data-pos", v.borderPosition);
    }
    const width = Math.min(T.PAGE_BORDER_MAX, Math.max(T.PAGE_BORDER_MIN, Number(v.pageBorder.width) || 3));
    e.preview.page.style.border = v.pageBorder.enabled ? `${width}px ${v.pageBorder.style} ${color}` : "";
    e.error.textContent = "";
  }

  function renderEditorSwatches() {
    const data = T.Store.data;
    ui.ed.swatches.replaceChildren(
      ...data.palette.map((c) =>
        h("button", {
          class: "tcz-swatch",
          title: c,
          style: { "--tcz-color": c },
          onclick: () => {
            ui.ed.color.value = c;
            ui.ed.hex.value = c;
            ui.ed.hex.classList.remove("tcz-invalid");
            updatePreview();
          },
        })
      )
    );
    if (!data.palette.length) {
      ui.ed.swatches.append(h("span", { class: "description-deemphasized", text: "No saved colors yet." }));
    }
  }

  function openEditor(rule = null) {
    const e = ui.ed;
    const draft = rule ?? {};
    ui.editingId = draft.id ?? null;
    ui.confirmMove = null;
    ui.editor.querySelector(".tcz-editor-title").textContent = draft.id ? "Edit rule" : "New rule";
    const draftSites = Array.isArray(draft.sites)
      ? draft.sites
      : draft.pattern
        ? [{ pattern: draft.pattern, type: draft.type }]
        : [];
    setSiteRows(draftSites);
    const color = T.normalizeHex(draft.color) ?? T.Store.data.palette[0] ?? "#1e88e5";
    e.color.value = color;
    e.hex.value = color;
    e.hex.classList.remove("tcz-invalid");
    e.tabStyle.value = draft.tabStyle ?? "background";
    e.borderPos.value = draft.borderPosition ?? "left";
    e.pageOn.checked = Boolean(draft.pageBorder?.enabled);
    e.pageWidth.value = e.pageWidthNum.value = String(draft.pageBorder?.width ?? 3);
    e.pageStyle.value = draft.pageBorder?.style ?? "solid";
    e.title.value = draft.title ?? "";
    e.showTitle.checked = Boolean(draft.pageBorder?.showTitle);
    renderEditorSwatches();
    updatePreview();
    ui.editor.hidden = false;
    e.siteRows.at(-1)?.input.focus();
    ui.editor.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function closeEditor() {
    ui.editor.hidden = true;
    ui.editingId = null;
    ui.confirmMove = null;
  }

  async function saveRule() {
    const v = editorValues();
    if (!v.sites.length) {
      ui.ed.error.textContent = "Add at least one site.";
      return;
    }
    // parsePatternInput turns a typed "*." prefix into a wildcard; otherwise the row's selector wins.
    const invalid = [];
    const sites = [];
    for (const site of v.sites) {
      const parsed = T.parsePatternInput(site.pattern, site.type);
      site.row.input.classList.toggle("tcz-invalid", !parsed);
      if (parsed) {
        sites.push(parsed);
      } else {
        invalid.push(site.pattern.trim());
      }
    }
    if (invalid.length) {
      ui.ed.error.textContent = `Not a valid host: ${invalid.join(", ")}. Use example.com, dev.example.com or *.example.com.`;
      return;
    }
    if (!v.color) {
      ui.ed.error.textContent = "Enter a valid hex color in the form #RRGGBB.";
      return;
    }
    v.sites = sites;

    // A site can only belong to one rule. Warn once before moving sites out of other rules.
    const keys = new Set(sites.map(T.siteKey));
    const moved = [];
    for (const r of T.Store.data.rules) {
      if (r.id === ui.editingId) {
        continue;
      }
      for (const site of r.sites) {
        if (keys.has(T.siteKey(site))) {
          moved.push(`${T.displaySite(site)} (from "${r.title || T.displaySite(r.sites[0])}")`);
        }
      }
    }
    const signature = moved.join("|");
    if (moved.length && ui.confirmMove !== signature) {
      ui.confirmMove = signature;
      ui.ed.error.textContent = `Already used in another rule and will be moved here: ${moved.join(", ")}. Click "Save rule" again to confirm.`;
      return;
    }
    try {
      await T.Store.upsertRule(v);
      closeEditor();
    } catch (err) {
      ui.ed.error.textContent = `Could not save the rule: ${err.message}`;
    }
  }

  /* ---------- Lists ---------- */

  function renderRules() {
    const sortKey = (r) => (r.title || r.sites[0].pattern).toLowerCase();
    const rules = [...T.Store.data.rules].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    if (!rules.length) {
      ui.ruleList.replaceChildren(
        h("p", { class: "description-deemphasized", text: "No rules yet. Add one, or right-click any tab → TabCalirizer." })
      );
      return;
    }
    ui.ruleList.replaceChildren(
      h(
        "div",
        { class: "tcz-rule tcz-rule-head" },
        h("span", {}),
        h("span", { text: "Sites" }),
        h("span", { text: "Tab" }),
        h("span", { text: "Page border" }),
        h("span", {})
      ),
      ...rules.map((r) =>
        h(
          "div",
          { class: "tcz-rule" },
          h("span", { class: "tcz-swatch tcz-swatch-static", title: r.color, style: { "--tcz-color": r.color } }),
          h(
            "span",
            { class: "tcz-rule-site" },
            r.title ? h("span", { class: "tcz-rule-title", text: r.title }) : null,
            ...r.sites.map((site) =>
              h(
                "span",
                { class: "tcz-rule-pattern", title: T.MATCH_TYPES[site.type] },
                T.displaySite(site),
                h("span", { class: "tcz-badge", text: SHORT_TYPE[site.type] })
              )
            )
          ),
          h(
            "span",
            {
              text:
                T.TAB_STYLES[r.tabStyle] +
                (r.tabStyle === "background" ? "" : ` (${T.BORDER_POSITIONS[r.borderPosition].toLowerCase()})`),
            }
          ),
          h("span", {
            text: r.pageBorder.enabled
              ? `${r.pageBorder.width}px ${r.pageBorder.style}${r.pageBorder.showTitle && r.title ? " + title" : ""}`
              : "Off",
          }),
          h(
            "span",
            { class: "tcz-actions" },
            h("button", { class: "tcz-small", text: "Edit", onclick: () => openEditor(r) }),
            h("button", { class: "tcz-small", text: "Delete", onclick: () => T.Store.removeRule(r.id) })
          )
        )
      )
    );
  }

  function renderTest() {
    const parsed = T.parsePatternInput(ui.testInput.value);
    if (!ui.testInput.value.trim()) {
      ui.testResult.textContent = "";
      return;
    }
    if (!parsed) {
      ui.testResult.textContent = "Not a valid host";
      return;
    }
    const match = T.matchHostDetailed(T.Store.data.rules, parsed.pattern);
    const rule = match?.rule;
    ui.testResult.replaceChildren(
      rule
        ? h(
            "span",
            {},
            "Matches ",
            h("span", { class: "tcz-swatch tcz-swatch-static", style: { "--tcz-color": rule.color } }),
            h("b", { text: ` ${rule.title ? `${rule.title} — ` : ""}${T.displaySite(match.site)}` }),
            ` (${T.MATCH_TYPES[match.site.type].toLowerCase()})`
          )
        : "No rule applies"
    );
  }

  function renderPalette() {
    const palette = T.Store.data.palette;
    ui.paletteList.replaceChildren(
      ...palette.map((c) =>
        h(
          "span",
          { class: "tcz-palette-item" },
          h("span", { class: "tcz-swatch tcz-swatch-static", style: { "--tcz-color": c } }),
          h("code", { text: c }),
          h("button", {
            class: "tcz-icon-btn",
            title: `Remove ${c}`,
            text: "×",
            onclick: () => T.Store.removePaletteColor(c),
          })
        )
      )
    );
    if (!palette.length) {
      ui.paletteList.append(h("span", { class: "description-deemphasized", text: "No saved colors yet." }));
    }
  }

  async function saveColorFrom(hexInput, errorEl = ui.ed.error) {
    const hex = readHex(hexInput);
    if (!hex) {
      errorEl.textContent = "Enter a valid hex color in the form #RRGGBB.";
      return;
    }
    errorEl.textContent = "";
    await T.Store.addPaletteColor(hex);
  }

  function savePaletteColor() {
    return saveColorFrom(ui.paletteHex, ui.paletteError);
  }

  function renderAll() {
    renderRules();
    renderPalette();
    renderTest();
    if (!ui.editor.hidden) {
      renderEditorSwatches();
    }
  }

  /* ---------- Import / export ---------- */

  function pickFile(mode, title) {
    const fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    fp.init(window.browsingContext, title, mode);
    fp.appendFilter("JSON", "*.json");
    if (mode === Ci.nsIFilePicker.modeSave) {
      fp.defaultString = "tabcalirizer-rules.json";
    }
    return new Promise((resolve) =>
      fp.open((res) => resolve(res === Ci.nsIFilePicker.returnCancel ? null : fp.file))
    );
  }

  function status(text, isError = false) {
    ui.ioStatus.textContent = text;
    ui.ioStatus.classList.toggle("tcz-error", isError);
  }

  async function exportToFile() {
    const file = await pickFile(Ci.nsIFilePicker.modeSave, "Export TabCalirizer data");
    if (!file) {
      return;
    }
    try {
      await IOUtils.writeUTF8(file.path, T.Store.exportJSON());
      status(`Exported to ${file.path}`);
    } catch (err) {
      status(`Export failed: ${err.message}`, true);
    }
  }

  function copyJSON() {
    Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(T.Store.exportJSON());
    status("Copied to the clipboard.");
  }

  async function importFromFile() {
    const file = await pickFile(Ci.nsIFilePicker.modeOpen, "Import TabCalirizer data");
    if (!file) {
      return;
    }
    try {
      const text = await IOUtils.readUTF8(file.path);
      const count = await T.Store.importJSON(text, { replace: ui.replaceCheck.checked });
      status(`Imported ${count} rule${count === 1 ? "" : "s"}.`);
    } catch (err) {
      status(`Import failed: ${err.message}`, true);
    }
  }

  /* ---------- Lifecycle ---------- */

  function consumeDraft() {
    const draft = T.Store.pendingDraft;
    T.Store.pendingDraft = null;
    showPane();
    if (draft) {
      openEditor(draft);
    }
  }

  function teardown() {
    for (const fn of cleanups.splice(0).reverse()) {
      try {
        fn();
      } catch {}
    }
    for (const el of injected.splice(0)) {
      el.remove();
    }
    delete window.__tabCalirizerPrefsLoaded;
  }

  async function init() {
    T = ChromeUtils.importESModule(`${BASE_URL}tabcalirizer-store.sys.mjs`);
    await T.Store.load();

    const link = document.createElementNS(HTML_NS, "link");
    link.rel = "stylesheet";
    link.href = `${BASE_URL}settings.css`;
    (document.head ?? document.documentElement).append(link);
    injected.push(link);

    addCategory();
    buildPane();
    renderAll();

    const changed = { observe: () => renderAll() };
    Services.obs.addObserver(changed, T.TOPIC);
    cleanups.push(() => Services.obs.removeObserver(changed, T.TOPIC));

    const openReq = { observe: () => consumeDraft() };
    Services.obs.addObserver(openReq, "tabcalirizer:open-settings");
    cleanups.push(() => Services.obs.removeObserver(openReq, "tabcalirizer:open-settings"));
    window.addEventListener("unload", teardown, { once: true });

    if (location.hash.toLowerCase() === HASH || T.Store.pendingDraft) {
      consumeDraft();
    }

    if (typeof window.addUnloadListener === "function") {
      window.addUnloadListener(teardown);
    }
  }

  init().catch((err) => console.error(LOG, "Init failed:", err));
})();
