# Marp GitHub Pages sample

This repository demonstrates how to organise multiple Marp slide decks so they can be published through GitHub Pages.

## Project layout

```
slides/<member>/<slug>/index.md  # Slide deck entry point
slides/<member>/<slug>/*         # Images or other assets for the deck
themes/                          # Shared custom themes
marp.config.js                   # Shared Marp CLI configuration
docs/                            # Build output for GitHub Pages
```

The docs/ directory already includes a `.nojekyll` file so that GitHub Pages serves files without Jekyll processing.

## Usage

1. Install dependencies:
   ```bash
   npm install
   ```
2. Generate static HTML for every deck:
   ```bash
   npm run build
   ```
   The command uses `marp.config.js` to read the `slides/` tree, load any theme files under `themes/`, and emit HTML decks under `docs/`.
3. (Optional) Preview decks locally with live reload:
   ```bash
   npm run start
   ```
   Visit the printed URL in your browser to browse every deck.

After `npm run build` completes, push the repository to GitHub and configure GitHub Pages to serve from the `docs/` folder.

## Adding a new deck

1. Create a new folder following `slides/<member>/<slug>/`.
2. Add an `index.md` file with Marp front-matter and your slides.
3. Drop any supporting images or media in the same folder and reference them with relative paths.
4. Run `npm run build` to generate the HTML deck in `docs/<member>/<slug>/`.
