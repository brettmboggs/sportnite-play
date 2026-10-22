# 🏆 SPORTNITE

A colorful 3D third-person battle royale where sports meet shooting.
Drop from the Sportnite Blimp, loot weapons in 7 rarities, build, use skills, beat the bosses, and be the
**last one standing** against 20–50 bots that get smarter as you get better.

## ▶️ How to play

**Easiest:** double-click the **SPORTNITE** icon on the desktop (it is also in the Games section of the start menu).
**Or in a terminal:**

```
cd sportnite
npm start
```

The game opens in Chrome.
Click the game window once to capture the mouse; press **Esc** to pause.

### 🖥️ Slow computer?

**Settings → Video → Graphics** is on **Auto** to start with. During a match it watches how smooth the game runs:
if it gets choppy it turns the graphics down (you'll see a message), and if it's super smooth it turns them back up.
It remembers what worked for next time. You can also pick one yourself:

| Graphics | Good for |
|---|---|
| **Potato** | Old or cheap laptops. No shadows or grass, shorter view, smaller picture, max 20 bots |
| **Low** | Most laptops |
| **Medium** | Laptops with a good graphics chip |
| **High** | Gaming PCs |

Turn on **Show FPS** to see how smooth it is (60 is perfect, under 30 feels choppy).

## 🎮 Controls

| Action | Keyboard + Mouse | PS5 Controller |
|---|---|---|
| Move / look | WASD / mouse | Left stick / right stick |
| Jump, open glider | Space | ✕ |
| Sprint (stamina runs out) | Shift | L3 (click left stick, stays on while you move) |
| Crouch / slide (crouch while sprinting) | Ctrl or C | R3 (click right stick, toggles) |
| Shoot / aim | Left click / right click | R2 / L2 |
| Reload | R | □ |
| Weapons | 1–5, scroll wheel, X for the bat | R1 / L1, △ for the bat |
| Pick up (tap), open chests (hold) | E | □ |
| Build mode | Q | ◯ (tap) |
| Build: wall / floor / ramp / cone | 1 2 3 4 (or F1–F4, Z, V) + hold click to turbo build | R2 / R1 / L2 / L1 |
| Switch build material | R (in build mode) | □ (in build mode) |
| Edit your wall (cut doors/windows) | G, click tiles, G to confirm | Hold ◯, R2 on tiles, ◯ to confirm |
| Skills | F and B | D-pad ← and → |
| Ultimate (after a kill streak) | U | D-pad ↑ |
| Emote / dance | H | D-pad ↓ |
| Map | M | Create / touchpad |
| Pause | Esc | Options |

### 🛹 Vehicles

About 40 vehicles are parked around the island every match (look for them on the minimap). Walk up and press
**E / □** to hop on, and **E / □** again to hop off.

| Vehicle | Drive | Special |
|---|---|---|
| **Sport Board** (hoverboard) | WASD / left stick | Shift / L3 = boost, Space / ✕ = ollie. In the air: steer to spin, ✕ again to kickflip. Land tricks to refill boost! |
| **Golf Cart** | WASD / left stick | Shift / L3 = boost, hold Space / ✕ while turning = drift (let go for a mini-turbo), click / R2 = honk. Run into enemies to bonk them. |
| **Sport Copter** | WASD / left stick (forward + turn) | Space / ✕ / R2 = up, Ctrl / L2 = down, Shift / L3 = boost. Has fuel and a height limit; lands safely. |

Vehicles can be shot and blown up (the driver gets thrown out safely). The storm still hurts you while you ride.

The controller works in every menu too: D-pad or left stick to move, ✕ to pick, ◯ to go back, L1/R1 to switch tabs.
Turn on the controller (press the PS button) before or after the game opens; a "PS5 DualSense connected!" message pops up.
**Settings → Controller** has sensitivity, deadzone, aim assist, vibration and a button tester.

## 🌟 What's in the game

- **The island:** Sports City (with the Sports District), Frosty Peaks, Candyland, Jungle Ruins and Haunted Hollow,
  plus 15 named places to land.
- **26 weapons:** pistols, SMGs, rifles, shotguns, snipers, a minigun, rocket and grenade launchers, a bow and a
  crossbow, a sword and a hammer.
  - **Wacky weapons:** freeze ray, lightning gun, bubble blaster, boomerang, chicken launcher, paint cannon.
  - **Sports weapons:** golf ball sniper, soccer cannon, and the Slam Dunk basketball grenade.
- **7 rarities:** Common, Uncommon, Rare, Epic, Legendary, Mythic and **Cosmic** (rainbow!).
  - Higher rarities get random **perks** and **elements** (fire, ice, lightning, poison, explosive).
- **Full building:** walls, floors, ramps and cones in wood, brick and metal. Swing your bat at trees, rocks and cars
  to collect materials.
- **13 skills** found as loot: dash, double jump, jetpack, grappling hook, shield bubble, invisibility, healing zone,
  turret, airstrike, slow-mo, wall-run, decoy clone and ground slam.
- **Kill-streak ultimates:** 3 eliminations unlocks Mega Shield, 5 unlocks Meteor Strike, and 8 unlocks MVP Mode
  (giant size + infinite ammo).
- **Loot:**
  - Chests, rare chests, ammo boxes and supply drops on basketball balloons
  - Vending machines and upgrade benches that spend gold
  - Health and shield potions, sports drinks, launch pads and bounce pads
- **3 bosses** guard Mythic weapons: The Mascot (Goal Stadium), The Candy King (Sweet Tooth Town) and The Headless
  Coach (Creepy Crypts).
- **The storm** closes in over 6 phases.
- **Timed bonus challenges** pop up during matches.
- **Mini-games:** Hoops, Home Run Derby and Penalty Kicks. Win them inside a match for a Rare Chest, or play them from
  the menu to earn coins.
- **Coach Mode:** the bots adapt to your skill. Each lobby mixes Rookie, Pro and All-Star bots. Easy, Normal, Hard and
  Insane are also available.
- **Locker:** 105 outfits (21 heroes, each in Original, Neon, Golden, Inferno and Cosmic), dances, gliders and wraps.
- **Item Shop** that changes every day, plus a free **100-tier reward track**.
- **Secrets:**
  - Cheat codes (try GODMODE, MOONJUMP, TURBO... there are more)
  - 5 hidden golden trophies
  - A dancing skeleton
  - A rare golden blimp

## 🛠️ For grown-ups

- Built with three.js (3D), Rapier (physics) and Vite (dev server). All three were checked with
  `../../tools/check-package.sh` before installing. `npm audit` shows 0 vulnerabilities.
- Progress saves in the browser's local storage. **Settings → Reset ALL progress** wipes it.
- `npm run build` makes the finished game in `dist/`. It's built with `base: './'`, so it works from any folder or
  web address.

### Playing online and working on it together

- **Play:** https://brettmboggs.github.io/sportnite-play/ (works in Chrome, Edge or Firefox, nothing to install).
- **Code:** https://github.com/brettmboggs/sportnite-play
- Every push to `main` rebuilds the game and updates the link automatically (takes about 2 minutes;
  see the repo's **Actions** tab). So whoever pushes last, everyone plays the newest version.

**To work on it on another computer:**
1. Install [Node.js](https://nodejs.org) (the LTS version) and [Git](https://git-scm.com).
2. `git clone https://github.com/brettmboggs/sportnite-play.git sportnite`
3. `cd sportnite`, then `npm install`, then `npm start`.
4. To send changes back, the repo owner adds your GitHub account as a collaborator
   (repo **Settings → Collaborators**). Then: `git pull` before you start, `git add -A`,
   `git commit -m "what I changed"`, `git push`.

Always `git pull` before starting, so two people don't change the same thing at the same time.
