# Primordia: cell stage

This is a browser game about evolution under environmental pressure. You guide a lineage of single cells through a sea that keeps changing. Oxygen rises, ice spreads and vents open. Every body part has a real mechanical effect, parts interact with each other, and every habitat pushes back on the body you build.

The **cell stage** follows the real path of early life: a simple bacterium, the partnership (endosymbiosis) that makes a complex cell, then a colony of cells that stick together.

## Play it

- **No setup:** open `dist/primordia.html` in a browser. Everything is in that one file.
- **From source:** run `npm run serve` (or `python3 -m http.server 8080`) in the repository root, then open http://localhost:8080. ES modules don't load from `file://`, so the source version needs the local server.
- **Install it as an app:** see [Install on a phone](#install-on-a-phone).
- **Hosting:** `index.html` works as-is on any static host, GitHub Pages included. `npm run build` regenerates `dist/primordia.html` (a self-contained copy) and `dist/artifact.html` (the version published to claude.ai).

Controls: WASD or arrow keys, or hold the mouse button (or your finger) to swim toward the pointer. Shift sprints. E or Space releases toxin. C turns your cell into a dormant cyst (and wakes it). R divides. Tab opens the ecosystem view, P pauses, M mutes and the mouse wheel zooms.

## Install on a phone

Hosted on GitHub Pages, the game is an installable web app: its own icon, full-screen launch and offline play. This uses `manifest.webmanifest`, `icons/`, the Apple tags in `index.html` and the offline cache in `sw.js`.

1. **Turn on GitHub Pages:** in the repository's Settings → Pages, choose *Deploy from a branch*, pick the branch and the root folder, and save. The address appears there after the first deploy, usually within a minute or two.
2. **iPhone or iPad:** open that address in Safari, tap Share, then **Add to Home Screen**.
3. **Android:** open it in Chrome and tap **Install app** on the title screen, or use **⋮ → Add to Home screen**.

Saves in the installed app stay on that device: they don't sync with the claude.ai version. The app asks the browser to keep its storage, and home-screen apps aren't subject to Safari's seven-day cleanup of website data.

The offline cache checks the network first, so updates arrive as soon as you're online, and falls back to the cache when offline or when the network is slow. Its cache names start with `primordia-`, because every project on the same GitHub Pages account shares one address, and other apps' caches must be left alone.

Run `npm run build` after changing files so `sw.js` lists the current files under a new version. To regenerate the icons, serve the repository (`npm run serve`) and run `npm run icons`.

## Saving

The game saves automatically every 20 seconds, after each division, and whenever the tab is hidden or closed. **Continue** on the title screen picks up where you left off, and the pause menu has a **Save now** button.

Saves go to two places (`js/save.js`):

- **This browser's localStorage.** Always used, and works offline.
- **A private document in your claude.ai account,** when the game runs as a claude.ai artifact. It lives under `data/users/<your id>/save`, which only you can read. The save is gzip-compressed to about 40 KB, and lets the lineage continue on another device, such as your phone. Writing it needs Contributor access or higher, so view-only visitors get local saves only.

When loading, the newer of the two saves wins. When your lineage dies out, the save is deleted. `npm run savetest` checks that a save and restore round trip keeps the world intact.

Saves are versioned. Version 2 belongs to cell stage 2.0; saves from the first cell stage (version 1) are not loaded, and are removed the first time the new version saves.

## Core loop

1. **Swim, feed, survive.** At this scale water is thick: a cell stops the moment its motor stops, and currents carry everything. A simple cell absorbs food it touches through its membrane, or makes its own from light or sulfur.
2. **Grow.** Spare energy fills the Division bar.
3. **Divide.** The editor opens with:
   - **Three free mutation offers.** They are weighted by what this generation actually went through (stress-induced mutation). For example, time near your cold limit brings up Antifreeze, and attacks from behind bring up a cell wall or spikes. Until you can sense your surroundings, chemoreceptors are always offered; once you are a complex cell, eyes are offered until you have an eye cup.
   - **DNA spending.** You can buy any unlocked part, change size, membrane thickness and (for simple cells) shape from round to rod, and move parts around. Each part tile has **− / +** buttons; minus never goes below what your cell already had. The cell view zooms and pans, and the **On this cell** list selects any part, even where parts overlap.
   - **How your parts work together.** A list of the interactions in your body, good and bad, drawn as glowing links between the parts on the cell.
   - **Endosymbiosis**, when a bacterium is living inside you (see below).
   - **Live stats and a habitat forecast** for now and the next era.
4. **Your lineage persists.** Each division adds a sibling. If you die you continue as the nearest relative (a colony member first). If every member dies, the lineage is extinct.

The stage is complete when your lineage forms a **colony of 4**. Milestones along the way are grouped by chapter in the ecosystem view, next to a timeline of every body your lineage has had.

## Systems

### The path: simple cell → complex cell → colony

- **Simple cell (prokaryote).** You start as a bacterium that twitches along on **pili**, which pull toward the side they sit on. A **rotary flagellum** gives fast straight runs, but turning means tumbling into a semi-random direction; **chemoreceptors** steer the tumbles (chemotaxis). **Gas vesicles** let photosynthesizers drift toward light.
- **Endosymbiosis.** After the Great Oxidation (or once you have divided a few times), oxygen-breathing bacteria (*Protomitos aerobius*) appear and look for larger simple cells to live in. When one slips inside you, the next division offers to keep it as a partner: it becomes your first **mitochondrion**, and your lineage becomes a **complex cell (eukaryote)**: bigger, with a nucleus, a cytoskeleton and new parts. Bacterial pili and rotary flagella are lost. AI lineages can make the same jump, so complex cells and bigger hunters appear in the pond. A complex cell that engulfs a photosynthetic bacterium may keep it as a **chloroplast**.
- **Complex cell (eukaryote).** Pseudopods (crawling and engulfing), cilia (smooth swimming and a feeding current), a whip-like flagellum, oral groove, food vacuole and lysosomes, a cytostome (cell mouth), armor plates, spikes and eyes.
- **Colony.** **Adhesion proteins** keep daughter cells attached. The colony moves as one, with more motors and more drag.

### Interactions between parts (`INTERACTIONS` in `js/genome.js`)

Parts change each other's effect. Examples: photosynthesis feeds oxygen straight to mitochondria; mitochondria power cilia and flagella; pseudopods plus a food vacuole allow engulfing; cilia sweep food into the oral groove; chemoreceptors steer a rotary flagellum; storage granules bank daytime surplus for the night and extend dormancy. Drawbacks too: pigment shades photosynthesis, a slime capsule hampers pili, and a rigid cell wall stops pseudopods and engulfing. The editor also gives hints for missing partners, such as a food vacuole without lysosomes.

### Environment (`js/environment.js`)

The pond is 2400×2400 µm. Static fields cover depth, vents, sulfur seeps, cold currents and swirling currents. Each point has five conditions:

| Condition | Source | Body interaction |
|---|---|---|
| Temperature | Depth, cold currents, vents, era | Tolerance range from Antifreeze, Heat-Shock Proteins and size. Cold water is also more viscous. |
| Light | Depth, ice cover, era, time of day | Thylakoids and chloroplasts turn light into energy. Low light reduces vision. |
| UV | Bright water × era × daylight (no ozone at first) | Pigment raises the UV limit. |
| Oxygen | Era baseline + local photosynthesis − sulfur | Catalase Enzymes raise the oxygen limit. Mitochondria cut energy costs when oxygen is present. |
| Sulfur | Vents, seeps, volcanic eras | Sulfide Enzymes raise the limit. Sulfur Metabolism turns sulfur into energy. |

Photosynthesizers really do add oxygen to the water around them. A **day and night cycle** (4 minutes) stops photosynthesis at night.

**Eras** run about 4–5 minutes each, with transitions and a visible forecast. The first is *Primordial Warmth* (no oxygen, harsh UV), followed by the *Great Oxidation*. After that the sequence is random among *Global Glaciation*, *Volcanic Upheaval* (new vents open), *Age of Blooms* and *Oxidation*.

### Dangers

- **Predators** at your own scale: predatory bacteria with a lytic tip, and later complex cells that bite or engulf. Nothing is hypermobile; hunters are only a little faster than their prey.
- **Viruses** are host-specific strains. A strain adapts to whichever species is most common ("kill the winner"), so success attracts them. An infection either clears or bursts the cell; **CRISPR** genes clear infections more often and remember the strain for lasting immunity.
- A **rotifer**, a many-celled animal, sometimes passes through and sucks in everything near its mouth.
- **Dormant cysts** (C): the cell seals itself and sleeps through almost anything, but can't eat or move.

### Sight (`js/vision.js`)

Every cell senses a short way in all directions; chemoreceptors extend that and let you tell other cells apart by scent. Eyes (complex cells only) add range in the direction they face. Eyes evolve in tiers, each adding **range** and **clarity**:

| Eye | Clarity | What you get |
|---|---|---|
| none | Light and dark | Beyond a short distance, other cells are blurry glows |
| Eyespot | Shapes | You see other cells' bodies and parts |
| Eye Cup | Detail | Threats are ringed red and prey green |
| Ocelloid | Sharp | Species name tags and off-screen predator arrows |

Living a generation with an eye unlocks its next tier. The camera frames what you can sense, so better senses literally widen your view.

### Ecosystem (`js/world.js`, `js/ai.js`, `js/species.js`)

- About 7 founding microbe species plus your own. AI cells flee, hunt, graze, seek hosts (symbionts), avoid the rotifer, encyst when it helps, and probe nearby water to move toward conditions they tolerate.
- AI divisions mutate under the same pressures, and genomes that drift far enough become a **new species** with a generated name. Common species are held back by crowding and viruses.
- Migrants recolonize empty habitats, and later complex-cell migrants arrive.
- **Horizontal gene transfer:** eating cells or their remains can unlock their parts for you.

### Sound (`js/audio.js`)

Ambient music is generated live with Web Audio: slow pads, a breathing drone, glassy bells and a hiss of water. Each era has its own key and scale; light brightens the sound and brings more bells, night darkens it, and a low dissonant pulse rises when something can eat you, the rotifer is near or you are infected. Sound effects are tuned to the current scale, so eating plays notes that fit the music. Volumes are in the pause menu; M mutes.

### Other files

- `js/pressures.js`: tracks the stress your generation experienced and builds the mutation offers.
- `js/biology.js`: shared rules for environmental damage, energy income and the habitat-fit score.
- `js/render.js`, `js/cellDraw.js`: Canvas 2D renderer in the Deep Glow style (visual concept B).
- `js/hud.js`, `js/editor.js`, `js/eco.js`, `js/main.js`: UI and the game loop.

## Tooling

- `npm run simtest -- 12 42 --player --start=vents` runs the ecosystem headless for 12 minutes and prints populations, era changes and causes of death. The simulation has no DOM code, so it runs in Node. Use it when changing balance numbers.
- `npm run build` bundles everything into `dist/primordia.html` (needs `npm install` once for esbuild).

## Known gaps and next steps

- Balance is still being tuned. Fast simple swimmers (*Vibrella*) tend to be the most common microbe, and how quickly complex cells take over varies between seeds.
- The editor works on touch screens but is easiest with a mouse.
- Ideas for later: a spatial layout inside the cell (organelles that need to be near each other), food-web and cause-of-death charts, division of labour inside colonies, and the next stage.
