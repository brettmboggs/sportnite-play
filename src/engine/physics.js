import RAPIER from '@dimforge/rapier3d-compat';

// Collision groups (16-bit membership << 16 | filter)
export const GROUP = { WORLD: 1, CHAR: 2, BUILD: 4, PROJECTILE: 8, LOOT: 16, TRIGGER: 32 };
export const groups = (member, filter) => (member << 16) | filter;

export class Physics {
  async init() {
    await RAPIER.init();
    this.R = RAPIER;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.owners = new Map(); // collider handle -> owner object { kind, ... }
  }

  reset() {
    this.world.free();
    this.world = new this.R.World({ x: 0, y: -9.81, z: 0 });
    this.owners.clear();
  }

  fixed(colliderDesc, owner, x = 0, y = 0, z = 0, rot = null) {
    const bd = this.R.RigidBodyDesc.fixed().setTranslation(x, y, z);
    if (rot) bd.setRotation(rot);
    const body = this.world.createRigidBody(bd);
    const col = this.world.createCollider(colliderDesc, body);
    if (owner) this.owners.set(col.handle, owner);
    return { body, col };
  }

  remove(entry) {
    if (!entry) return;
    if (entry.col) this.owners.delete(entry.col.handle);
    if (entry.body) this.world.removeRigidBody(entry.body);
  }

  ownerOf(collider) { return this.owners.get(collider.handle); }

  // Raycast returning {owner, point, normal, dist, collider} or null
  raycast(origin, dir, maxDist, excludeCollider = null, filterGroups = undefined, predicate = undefined) {
    const ray = new this.R.Ray(origin, dir);
    const hit = this.world.castRayAndGetNormal(ray, maxDist, true, undefined, filterGroups, excludeCollider || undefined, undefined, predicate);
    if (!hit) return null;
    const t = hit.timeOfImpact ?? hit.toi;
    return {
      collider: hit.collider,
      owner: this.owners.get(hit.collider.handle),
      dist: t,
      point: { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t },
      normal: hit.normal,
    };
  }

  step(dt) {
    this.world.timestep = Math.min(dt, 1 / 30);
    this.world.step();
  }
}

export const physics = new Physics();
