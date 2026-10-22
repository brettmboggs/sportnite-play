# SPORTNITE: Game Plan

A colorful, 3D, third-person battle royale where sports meet shooting.
Drop from the **Sportnite Blimp**, loot weapons in 7 rarities, build, use skills, and be the last one standing
against 20–50 bots that adapt to your skill.

## The match
- **Drop-in:** the Sportnite Blimp flies across the island. Jump out, skydive, open your glider, land anywhere.
- **The Storm** shrinks in phases. Outside it you take damage that gets worse each phase.
- **20–50 bots** (you pick, default 35): regular people in different outfits, with mixed skill levels.
- **Adaptive AI ("Coach Mode"):** the game remembers how well you play and makes the bots smarter, faster, and
  better at building as you improve. Each match mixes Rookie, Pro, and All-Star bots. A win should feel *earned*.
- **Match length:** about 8–12 minutes. Victory screen: **"SPORTNITE CHAMPION!"** with a trophy and a dance.

## The island (5 areas)
| Area | Landmarks |
|---|---|
| **Jungle** | ruins, waterfall, rope bridges, giant trees |
| **Mountains** | snowy peak, ski lodge, cliffs (great for snipers) |
| **City** | skyscrapers, streets, and the **Sports District**: stadium, basketball court, baseball field |
| **Haunted Forest** | graveyard, spooky mansion, fog, glowing eyes in the dark |
| **Candyland** | lollipop trees, frosting hills, giant donut, chocolate river |

## Weapons
**7 rarities:** Common (gray) · Uncommon (green) · Rare (blue) · Epic (purple) · Legendary (gold) · Mythic (glowing red) · Cosmic (animated rainbow).
Higher rarity = more damage, faster reload, more glow, and better perks.

**Classes:** pistol, revolver, SMG, assault rifle, burst rifle, shotgun, sniper, minigun, rocket launcher,
grenade launcher, bow, crossbow, grenades, melee (bat, sword, hammer).
**Wacky weapons:** freeze ray, lightning gun, bubble blaster, boomerang, black-hole grenade, chicken launcher,
paint cannon.
**Sports weapons:** basketball "Slam Dunk" grenade (bounces and then explodes), soccer-ball cannon, golf-ball sniper,
and the baseball bat pickaxe (you swing it to harvest materials and for melee).

- **Elements:** fire (burn), ice (slow and freeze), lightning (chains between enemies), poison (cloud), explosive
- **Random perks** on Epic and up (bouncing bullets, explosive rounds, +fire rate, vampire heal...)
- **Upgrade benches:** spend gold coins to raise a weapon's rarity
- **Fortnite-style ammo:** light, medium, heavy, shells, rockets
- **Headshots** do ×2 damage with a *ding*. Hits show damage numbers.
- **5 weapon slots** plus a pickaxe slot
- **Blood:** cartoon blood splatter on hits (with an on/off switch in Settings)

## Skills (found as loot)
Dash · double jump · jetpack · grappling hook · shield bubble · invisibility · healing zone · turret ·
airstrike · slow-motion · wall-run · decoy clone · ground slam

**Kill-streak ultimates** unlock at 3, 5, and 8 eliminations in one life: for example a **Mega-Shield**,
a **Meteor Strike**, or **MVP Mode** (giant size and infinite ammo for 10 seconds).

**Consumables:** small and big shield potions, bandages, med kits, launch pads, bounce pads.

## Building (full builds)
- Walls, floors, ramps, and cones on a grid, with Fortnite-style controls and turbo build
- 3 materials (wood, brick, metal) gathered by swinging the bat at trees, rocks, and cars
- Pieces have health and can be shot down. **Edit mode** lets you cut windows and doors (added in a later phase).
- Bots build too, and better bots build more.

## Movement
Sprint (the stamina bar runs out), crouch, slide, jump, mantle up ledges, and a glider for drops and launch pads.

## Loot
Floor loot, chests (glowing and humming), rare chests, supply drops that fall from the sky, vending machines, and
**bosses** that guard Mythic weapons:
- **The Mascot** (city stadium): a giant angry team mascot
- **The Candy King** (Candyland)
- **The Headless Coach** (Haunted Forest)

## Progression (saved between games)
- XP and levels, plus a **free 100-tier reward track**
- **Locker:** skins (with rarities, plus rare animated and glowing ones), weapon wraps, gliders, blimp
  trails, emotes and dances
- Coins for the item shop. All coins are earned by playing, never with real money.
- **Timed bonus challenges** during matches ("3 eliminations in 60 seconds = +500 XP")

## Sportnite mini-games
Playable two ways: **inside matches** (win one at its court or field to make a loot chest pop out) and from
the **main menu** as a separate mode.
- **Home Run Derby** (baseball field)
- **Hoops** (basketball court)
- **Penalty Kicks** (soccer stadium)
- **Mini-Golf** (later: trick holes around the island)

## Secrets and fun
Cheat codes in the menu, a hidden secret room, Easter eggs on the map, a rare golden-blimp event,
and a secret "Cosmic" skin unlocked by finding hidden trophies.

## Controls
Keyboard and mouse, plus **PS5 controller** support (aim assist on controller).
Settings: sensitivity, graphics quality, FOV, volume, blood toggle, keybinds.

## Tech (for Brett)
- Runs in the browser (Chrome is best). Built with **Three.js** (3D), **Rapier** (physics), and **Vite** (dev server).
  All three are checked with `tools/check-package.sh` before installing.
- Art: free 3D packs from **Quaternius** and **Kenney** that anyone may use (CC0), virus-scanned, with only
  model, image, and sound files kept. Credits are listed in `CREDITS.md`.
- Start it with one command, `npm start`, or with a desktop shortcut.

## Build order (each step is playable)
1. **Island and movement:** the 5-area island, your character running, jumping, sliding, sprinting, camera
2. **Shooting:** weapons, rarities, ammo, damage numbers, headshots, the bat
3. **Bots:** AI that loots, fights, and adapts to you
4. **Battle royale loop:** blimp drop, glider, storm, victory and defeat screens
5. **Building:** walls, floors, ramps, cones, materials, then edit mode
6. **Loot and skills:** chests, supply drops, vending, upgrade benches, skills, ultimates, bosses
7. **Locker and progression:** skins, XP, reward track, emotes
8. **Sports mini-games**
9. **Polish:** music, sound, effects, controller, settings, secrets
