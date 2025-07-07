import { world, system, BlockTypes, Player, Block, Vector3, BlockPermutation, Dimension } from "@minecraft/server";

const DP_KEY = "lockableChestOwners";
let chestOwners = new Map<string, string>();

// Helper to stringify a block position
function keyFor(loc: Vector3): string {
  return `${loc.x}:${loc.y}:${loc.z}`;
}

// Load persisted locks from world dynamic properties
function loadLocks(): void {
  const raw = world.getDynamicProperty(DP_KEY);
  if (typeof raw !== "string") return;
  try {
    chestOwners = new Map(Object.entries(JSON.parse(raw)));
    console.log(`[LockableChests] Loaded ${chestOwners.size} locks.`);
  } catch (e) {
    console.error(`[LockableChests] parse error:`, e);
  }
}

// Save locks back to world dynamic properties
function saveLocks(): void {
  try {
    world.setDynamicProperty(DP_KEY, JSON.stringify(Object.fromEntries(chestOwners)));
  } catch (e) {
    console.error(`[LockableChests] save error:`, e);
  }
}

// Initialize on world load
world.afterEvents.worldLoad.subscribe(() => {
  loadLocks();
});

// When a player places a chest
world.afterEvents.playerPlaceBlock.subscribe(({ player, block }) => {
  if (block.permutation.type.id !== "minecraft:chest") return;

  const pos = block.location;
  const below = player.dimension.getBlock({ x: pos.x, y: pos.y - 1, z: pos.z });

  // 1) Inherit an adjacent lock if present
  const adjOffsets = [
    { x:  1, y: 0, z:  0 },
    { x: -1, y: 0, z:  0 },
    { x:  0, y: 0, z:  1 },
    { x:  0, y: 0, z: -1 },
  ];
  let owner: string | null = null;
  for (const off of adjOffsets) {
    const adjKey = keyFor({ x: pos.x + off.x, y: pos.y, z: pos.z + off.z });
    if (chestOwners.has(adjKey)) {
      owner = chestOwners.get(adjKey)!;
      break;
    }
  }

  // 2) Lock new chest if placed on cobblestone
  if (!owner && below?.type.id === "minecraft:cobblestone") {
    owner = player.nameTag;
  }

  if (owner) {
    const myKey = keyFor(pos);
    chestOwners.set(myKey, owner);
    saveLocks();
    player.sendMessage(`🔒 Chest at ${myKey} locked to ${owner}`);
  }
});

// Prevent non-owners from opening
world.beforeEvents.playerInteractWithBlock.subscribe(ev => {
  if (ev.block.permutation.type.id !== "minecraft:chest") return;
  const owner = chestOwners.get(keyFor(ev.block.location));
  if (owner && owner !== ev.player.nameTag) {
    ev.cancel = true;
    ev.player.sendMessage(`❌ Locked by ${owner}`);
  }
});

// Prevent breaking by non-owners; clean up on owner break
world.beforeEvents.playerBreakBlock.subscribe(ev => {
  if (ev.block.permutation.type.id !== "minecraft:chest") return;
  const key = keyFor(ev.block.location);
  const owner = chestOwners.get(key);

  if (owner && owner !== ev.player.nameTag) {
    ev.cancel = true;
    ev.player.sendMessage(`❌ You cannot break ${owner}'s chest`);
  } else if (owner === ev.player.nameTag) {
    chestOwners.delete(key);
    saveLocks();
  }
});

// Protect locked chests from explosions
world.beforeEvents.explosion.subscribe(ev => {
  const impactedBlocks = ev.getImpactedBlocks();
  ev.setImpactedBlocks(impactedBlocks.filter(block =>
    !chestOwners.has(keyFor(block.location))
  ));
});