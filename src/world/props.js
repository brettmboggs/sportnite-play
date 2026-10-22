// Prop catalogue per biome: which models to scatter, how big, how many, and what they give when harvested.
// h = target height in meters (randomised ±20%), mat = harvest material, hp = harvest health
// col = collider: 'trunk' | 'box' (convex hull of the model) | 'none'
// sway = how much the wind bends it (trees ~1, bushes and grass more), sink = fraction pushed into the ground (cones planted tip-first)

export const PROP_SETS = {
  mountains: [
    { file: 'nature/k/tree_pineTallA_detailed.glb', h: 14, n: 70, mat: 'wood', hp: 200, col: 'trunk', sway: 1 },
    { file: 'nature/k/tree_pineTallB_detailed.glb', h: 12, n: 70, mat: 'wood', hp: 200, col: 'trunk', sway: 1 },
    { file: 'nature/k/tree_pineRoundA.glb', h: 9, n: 50, mat: 'wood', hp: 150, col: 'trunk', sway: 1 },
    { file: 'holiday/tree-snow-a.glb', h: 11, n: 50, mat: 'wood', hp: 180, col: 'trunk', minY: 32, sway: 1 },
    { file: 'holiday/tree-snow-b.glb', h: 9, n: 40, mat: 'wood', hp: 160, col: 'trunk', minY: 32, sway: 1 },
    { file: 'nature/k/rock_largeA.glb', h: 4, n: 50, mat: 'brick', hp: 300, col: 'box' },
    { file: 'nature/k/rock_tallA.glb', h: 6, n: 30, mat: 'brick', hp: 350, col: 'box' },
    { file: 'nature/k/cliff_large_rock.glb', h: 12, n: 14, col: 'box' },
    { file: 'holiday/snowman.glb', h: 2.4, n: 8, mat: 'brick', hp: 80, col: 'box', minY: 30 },
    { file: 'nature/k/log_stack.glb', h: 1.6, n: 10, mat: 'wood', hp: 120, col: 'box' },
  ],
  candy: [
    { file: 'food/lollypop.glb', h: 10, n: 60, mat: 'wood', hp: 150, col: 'trunk', tint: 'candy' },
    { file: 'holiday/candy-cane-red.glb', h: 9, n: 35, mat: 'wood', hp: 150, col: 'trunk' },
    { file: 'holiday/candy-cane-green.glb', h: 9, n: 25, mat: 'wood', hp: 150, col: 'trunk' },
    { file: 'food/cupcake.glb', h: 6, n: 18, mat: 'brick', hp: 250, col: 'box' },
    { file: 'food/donut-sprinkles.glb', h: 3.5, n: 14, mat: 'brick', hp: 200, col: 'box' },
    { file: 'food/ice-cream.glb', h: 8, n: 16, mat: 'brick', hp: 220, col: 'trunk', sink: 0.22 },
    { file: 'food/popsicle.glb', h: 7, n: 16, mat: 'wood', hp: 150, col: 'trunk' },
    { file: 'food/cake-birthday.glb', h: 5, n: 8, mat: 'brick', hp: 300, col: 'box' },
    { file: 'holiday/gingerbread-man.glb', h: 6, n: 10, mat: 'brick', hp: 200, col: 'box' },
    { file: 'holiday/present-a-cube.glb', h: 2.5, n: 18, mat: 'wood', hp: 100, col: 'box' },
    { file: 'holiday/present-b-round.glb', h: 2.2, n: 14, mat: 'wood', hp: 100, col: 'box' },
    { file: 'food/candy-bar.glb', h: 2, n: 12, mat: 'metal', hp: 160, col: 'box' },
    { file: 'nature/k/mushroom_redTall.glb', h: 4, n: 20, mat: 'wood', hp: 80, col: 'trunk' },
  ],
  jungle: [
    { file: 'nature/k/tree_palmTall.glb', h: 15, n: 70, mat: 'wood', hp: 200, col: 'trunk', sway: 1.4 },
    { file: 'nature/k/tree_palmDetailedTall.glb', h: 13, n: 60, mat: 'wood', hp: 200, col: 'trunk', sway: 1.4 },
    { file: 'nature/k/tree_palmBend.glb', h: 11, n: 40, mat: 'wood', hp: 180, col: 'trunk', sway: 1.4 },
    { file: 'nature/q/MapleTree_3.gltf', h: 16, n: 45, mat: 'wood', hp: 250, col: 'trunk', sway: 1 },
    { file: 'nature/q/BirchTree_2.gltf', h: 14, n: 30, mat: 'wood', hp: 220, col: 'trunk', sway: 1 },
    { file: 'nature/q/Bush_Large_Flowers.gltf', h: 2.2, n: 80, col: 'none', sway: 4 },
    { file: 'nature/q/Bush_Large.gltf', h: 2, n: 80, col: 'none', sway: 4 },
    { file: 'nature/k/plant_bushLarge.glb', h: 2, n: 60, col: 'none', sway: 4 },
    { file: 'nature/k/statue_head.glb', h: 6, n: 6, mat: 'brick', hp: 400, col: 'box' },
    { file: 'nature/k/statue_columnDamaged.glb', h: 6, n: 14, mat: 'brick', hp: 300, col: 'box' },
    { file: 'nature/k/statue_obelisk.glb', h: 9, n: 6, mat: 'brick', hp: 400, col: 'box' },
    { file: 'nature/k/rock_largeB.glb', h: 3.5, n: 30, mat: 'brick', hp: 300, col: 'box' },
    { file: 'nature/k/log_large.glb', h: 1.2, n: 16, mat: 'wood', hp: 120, col: 'box' },
    { file: 'nature/k/mushroom_tanGroup.glb', h: 1.2, n: 30, col: 'none' },
  ],
  haunted: [
    { file: 'nature/q/DeadTree_1.gltf', h: 12, n: 45, mat: 'wood', hp: 180, col: 'trunk', sway: 0.6 },
    { file: 'nature/q/DeadTree_3.gltf', h: 11, n: 40, mat: 'wood', hp: 180, col: 'trunk', sway: 0.6 },
    { file: 'nature/q/DeadTree_6.gltf', h: 10, n: 35, mat: 'wood', hp: 180, col: 'trunk', sway: 0.6 },
    { file: 'graveyard/pine-crooked.glb', h: 11, n: 40, mat: 'wood', hp: 180, col: 'trunk', sway: 1 },
    { file: 'graveyard/pine.glb', h: 12, n: 30, mat: 'wood', hp: 180, col: 'trunk', sway: 1 },
    { file: 'graveyard/gravestone-cross.glb', h: 1.8, n: 60, mat: 'brick', hp: 90, col: 'box' },
    { file: 'graveyard/gravestone-round.glb', h: 1.5, n: 60, mat: 'brick', hp: 90, col: 'box' },
    { file: 'graveyard/gravestone-decorative.glb', h: 2, n: 30, mat: 'brick', hp: 90, col: 'box' },
    { file: 'graveyard/pumpkin-carved.glb', h: 1.1, n: 30, mat: 'wood', hp: 50, col: 'box', glow: 0xff8a1a },
    { file: 'graveyard/lightpost-single.glb', h: 4, n: 18, mat: 'metal', hp: 150, col: 'trunk', glow: 0xffc266 },
    { file: 'graveyard/crypt.glb', h: 5, n: 6, mat: 'brick', hp: 500, col: 'box' },
    { file: 'graveyard/rocks-tall.glb', h: 3, n: 25, mat: 'brick', hp: 250, col: 'box' },
    { file: 'graveyard/iron-fence.glb', h: 2, n: 40, mat: 'metal', hp: 120, col: 'box' },
  ],
  city: [
    { file: 'nature/k/tree_default.glb', h: 8, n: 40, mat: 'wood', hp: 150, col: 'trunk', sway: 1 },
    { file: 'nature/k/tree_oak.glb', h: 9, n: 30, mat: 'wood', hp: 150, col: 'trunk', sway: 1 },
    { file: 'props/Debris_BrokenCar.glb', h: 1.6, n: 18, mat: 'metal', hp: 300, col: 'box' },
    { file: 'props/Container_Long.glb', h: 2.8, n: 8, mat: 'metal', hp: 400, col: 'box' },
    { file: 'props/TrashContainer.glb', h: 1.6, n: 16, mat: 'metal', hp: 150, col: 'box' },
    { file: 'props/Barrier_Large.glb', h: 1.2, n: 16, mat: 'brick', hp: 150, col: 'box' },
    { file: 'props/CardboardBoxes_2.glb', h: 1.2, n: 16, mat: 'wood', hp: 50, col: 'box' },
    { file: 'props/WaterTank_Platform.glb', h: 8, n: 4, mat: 'metal', hp: 400, col: 'box' },
  ],
  // things scattered everywhere on the island
  all: [
    { file: 'nature/q/Grass_Large.gltf', h: 0.8, n: 160, col: 'none', notIn: ['candy', 'city'], sway: 9 },
    { file: 'nature/q/Flower_3_Clump.gltf', h: 0.6, n: 200, col: 'none', notIn: ['haunted', 'mountains'], sway: 9 },
    { file: 'nature/q/Bush.gltf', h: 1.5, n: 120, col: 'none', notIn: ['candy'], sway: 4 },
    { file: 'nature/k/rock_smallA.glb', h: 0.8, n: 100, col: 'none' },
  ],
};

export const CITY_BUILDINGS = [
  'city/building-a.glb', 'city/building-b.glb', 'city/building-c.glb', 'city/building-d.glb', 'city/building-e.glb',
  'city/building-f.glb', 'city/building-g.glb', 'city/building-h.glb', 'city/building-i.glb', 'city/building-j.glb',
  'city/building-k.glb', 'city/building-l.glb', 'city/building-m.glb', 'city/building-n.glb',
];
export const SKYSCRAPERS = [
  'city/building-skyscraper-a.glb', 'city/building-skyscraper-b.glb', 'city/building-skyscraper-c.glb',
  'city/building-skyscraper-d.glb', 'city/building-skyscraper-e.glb',
];
export const SUBURB_HOUSES = [
  'suburb/building-type-a.glb', 'suburb/building-type-b.glb', 'suburb/building-type-c.glb', 'suburb/building-type-d.glb',
  'suburb/building-type-e.glb', 'suburb/building-type-f.glb', 'suburb/building-type-g.glb', 'suburb/building-type-h.glb',
];

export function allPropFiles() {
  const s = new Set();
  for (const list of Object.values(PROP_SETS)) for (const p of list) s.add(p.file);
  for (const f of [...CITY_BUILDINGS, ...SKYSCRAPERS, ...SUBURB_HOUSES]) s.add(f);
  return [...s];
}
