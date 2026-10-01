# Context
You are a senior developer with deep knowledge of Firefox internals (browser chrome DOM, XUL/HTML chrome, privileged JS, Services.prefs, IOUtils) and of the Zen Browser codebase. Build from scratch a **Zen Browser mod** called **TabCalirizer** in this project folder (C:\Work\Training\TabCalirizer).

It is a JavaScript + CSS mod loaded through **Sine** (https://github.com/CosmoCreeper/Sine), the community mod manager for Zen. It is NOT a WebExtension and NOT an official Zen Store mod (those are CSS-only and can't do this).

# Goal
Color each tab according to rules by domain/subdomain, so the color **stays visible on inactive tabs**. Optionally draw a border around the web content area in the same color.

# Phase 1 — Research (BEFORE writing code)
1. Check Sine's current repo and wiki for:
   - The exact JS mod format: required files, `theme.json` fields, how JS files are declared and loaded, and how to install a local mod during development.
   - Whether Sine mod preferences can support the needed settings UI or whether a custom panel is required.
2. Check whether a JS mod can add its own section or subpage to Zen's settings page (`about:preferences`) with custom HTML (rule list, color picker, palette), and whether it stays stable across Zen updates.
3. Inspect the current Zen tab DOM: the tab element (`.tabbrowser-tab` or its Zen equivalent in the vertical sidebar), pinned/essential tabs, folders, split view, compact mode, and how to read each tab's URL (`tab.linkedBrowser.currentURI`).
4. Identify the events to listen to: `TabOpen`, `TabClose`, `TabAttrModified`, a tabs progress listener for location changes, workspace switches, and window open.

Give me a short report covering:
- The confirmed mod structure
- The DOM selectors
- The events
- Whether settings integration is feasible
- Your proposed architecture

**Wait for my confirmation before Phase 2.**

# Phase 2 — Functional requirements
1. **Rules by domain and subdomain**
   - Rule types:
     - Exact host (`mail.google.com`)
     - Domain including all subdomains (`*.google.com`)
     - Base domain only (`google.com`)
   - Precedence: the most specific rule wins. The UI shows which rule matches the current tab.
   - Each rule has its own:
     - Hex color
     - Tab style: `background`, `border` (left accent or full outline) or both
     - Content border: enabled/disabled, thickness in px (1–20), style `solid` or `dashed`
   - Tabs with no matching rule remain unchanged.
   - Colors apply to every tab (active, inactive, pinned, inside folders, all workspaces) and update live on navigation.

2. **Readability**
   - When the tab background is colored, automatically pick a light or dark text color for contrast.
   - The active tab must still be distinguishable, e.g. a stronger shade or an outline.

3. **Content border**
   - Draw it in the browser chrome around the content area (an overlay on the browser stack with `pointer-events: none`), not inside the web page.
   - It must work on any page, including `about:` and PDFs, and must not intercept clicks or shift the layout.
   - In split view, each pane shows the border of its own tab's rule.

4. **Settings UI**
   - **Location:**
     - Preferred: integrated into Zen's settings page (`about:preferences`) as its own section or subpage, if Phase 1 confirms it is feasible and reasonably stable.
     - Fallback: a separate window or panel (e.g. a chrome dialog or a dedicated `about:`-style page opened in a tab).
   - **Access:** a toolbar button and the tab context menu.
   - **Contents:**
     - Hex color picker with validation (`#RRGGBB`).
     - Saved color palette: save, reuse, delete.
     - Rule list: create, edit, delete, plus a live preview.
     - Import/export rules as JSON.
   - **Quick action:** "Color this site…" in the tab context menu, for the tab's host or base domain.

5. **Persistence**
   - Store rules and palette in a JSON file in the profile folder (or prefs if more appropriate; justify the choice).
   - They must survive restarts and Zen updates.

# Technical constraints
- Plain JS and CSS, no build step. All UI text, code, comments and naming in **English**.
- Defensive code: if a selector or Zen API is missing (e.g. after a Zen update), log a clear warning and degrade gracefully. Never break the browser UI.
- Clean up listeners and injected elements when the mod is disabled.
- Keep Zen-specific selectors in one constants section so they're easy to fix after Zen updates.

# Deliverables
- Mod files in the structure Sine requires.
- README.md covering:
  - How to install Sine and load the mod locally on Windows
  - How to use it
  - How to debug with the Browser Toolbox
  - Known limitations

# Quality criteria
- Loads in Zen via Sine without errors in the Browser Console.
- Inactive tabs keep their color; `mail.google.com` overrides `*.google.com`.
- Solid and dashed borders render correctly at every thickness, including in split view.
- Text stays readable on every color.
- Rules and palette persist after restarting Zen.

# Final verification
Before finishing, check that:
- Every requirement is implemented, or listed as a known limitation.
- Disabling the mod leaves no leftover styles or elements.
- No Spanish text remains in the mod.
