import * as THREE from 'three';

// Stylized "pop" for characters, held weapons and loot: a soft fresnel rim light, like Fortnite's, so they
// read clearly against busy backgrounds. One shared shader program for every material that uses it, and the
// colour/strength are shared uniforms (the game tints them per biome).
export const rimUniforms = {
  uRimColor: { value: new THREE.Color(0xe4f1ff) },
  uRimStrength: { value: 0.5 },
};

const patched = new WeakSet();

export function addRim(mat, strength = 1) {
  if (!mat || !mat.isMeshStandardMaterial || patched.has(mat)) return mat;
  patched.add(mat);
  mat.userData.rimK = strength;
  const k = strength.toFixed(2);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uRimColor = rimUniforms.uRimColor;
    sh.uniforms.uRimStrength = rimUniforms.uRimStrength;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor; uniform float uRimStrength;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float nv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          float rim = pow(1.0 - nv, 3.0);
          // brighter on the upper, sky-facing edges
          float up = dot(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz)) * 0.5 + 0.5;
          rim *= 0.45 + 0.55 * up;
          totalEmissiveRadiance += uRimColor * mix(diffuseColor.rgb, vec3(1.0), 0.55) * rim * uRimStrength * ${k};
        }`);
  };
  mat.customProgramCacheKey = () => 'rim' + k;
  mat.needsUpdate = true;
  return mat;
}

export function addRimTo(obj, strength = 1) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) addRim(m, strength);
  });
  return obj;
}
