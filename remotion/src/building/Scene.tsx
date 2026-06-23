import React from "react";
import { MODEL, center, size, zoneState, type Box } from "./model.ts";

const SYS_COLORS = MODEL.systems.map((s) => s.color);
const GLASS = MODEL.palette.glazing ?? "#7fd4ff";
const BASE = MODEL.palette.base ?? "#202833";

// colour by how many systems have reached a zone: 1 structure → 4 fit-out.
const colorFor = (reached: number) =>
  SYS_COLORS[Math.max(0, Math.min(SYS_COLORS.length - 1, reached - 1))];

const Slab: React.FC<{ box: Box; color: string }> = ({ box, color }) => {
  const c = center(box);
  const s = size(box);
  return (
    <mesh position={c} receiveShadow>
      <boxGeometry args={[s[0], s[1], s[2]]} />
      <meshStandardMaterial color={color} roughness={0.9} metalness={0.05} />
    </mesh>
  );
};

/** A block that grows from its base as `rise` goes 0→1, coloured by system. */
const Block: React.FC<{ box: Box; rise: number; color: string }> = ({ box, rise, color }) => {
  const c = center(box);
  const s = size(box);
  return (
    <group position={[c[0], box.min[1], c[2]]} scale={[1, Math.max(0.0001, rise), 1]}>
      <mesh position={[0, s[1] / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[s[0], s[1], s[2]]} />
        <meshStandardMaterial
          color={color}
          roughness={0.78}
          metalness={0.08}
          emissive={color}
          emissiveIntensity={0.07}
        />
      </mesh>
    </group>
  );
};

const Glass: React.FC<{ box: Box; opacity: number }> = ({ box, opacity }) => {
  if (opacity <= 0.001) return null;
  const c = center(box);
  const s = size(box);
  return (
    <mesh position={c}>
      <boxGeometry args={[s[0], s[1], s[2]]} />
      <meshStandardMaterial
        color={GLASS}
        transparent
        opacity={0.8 * opacity}
        roughness={0.08}
        metalness={0.7}
        emissive={GLASS}
        emissiveIntensity={0.55 * opacity}
      />
    </mesh>
  );
};

export const BuildingScene: React.FC<{ p: number }> = ({ p }) => {
  return (
    <group>
      <Slab box={MODEL.base} color={BASE} />
      {MODEL.zones.map((z) => {
        const st = zoneState(z, p);
        if (!st.visible) return null;
        return (
          <group key={z.id}>
            <Block box={z.structure} rise={st.rise} color={colorFor(st.reached)} />
            {z.glazing.map((g, i) => (
              <Glass key={i} box={g.box} opacity={st.glass} />
            ))}
          </group>
        );
      })}
    </group>
  );
};
