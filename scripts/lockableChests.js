import { world, system } from "@minecraft/server";
import { MinecraftBlockTypes } from "@minecraft/vanilla-data";

const DP_KEY = "lockableChestOwners";
let chestOwners = new Map();

// Helper to turn a Vector3 into a string key
function keyFor(loc) {
    return `${loc.x}:${loc.y}:${loc.z}`;
}

// Load persisted map from world dynamic property
function loadLocks() {
    const raw = world.getDynamicProperty(DP_KEY);
    if (!raw) return;
    try {
        const obj = JSON.parse(raw);
        chestOwners = new Map(Object.entries(obj));
        console.log(`[LockableChests] Loaded ${chestOwners.size} locks.`);
    } catch (e) {
        console.error(`[LockableChests] failed to parse dynamic property:`, e);
    }
}

// Save map back into world dynamic property
function saveLocks() {
    try {
        world.setDynamicProperty(DP_KEY, JSON.stringify(Object.fromEntries(chestOwners)));
    } catch (e) {
        console.error(`[LockableChests] failed to stringify dynamic property:`, e);
    }
}

// Initialize on world load
system.beforeEvents.worldInitialize.subscribe(() => {
    loadLocks();
});

// When any player places a chest
world.afterEvents.playerPlaceBlock.subscribe(({ player, block }) => {
    if (block.permutation.type.id !== MinecraftBlockTypes.chest.id) return;

    const pos = block.location;
    const below = player.dimension.getBlock({ x: pos.x, y: pos.y - 1, z: pos.z });

    // 1) Check adjacent chests
    const adj = [
        { x: 1, y: 0, z: 0 },
        { x: -1, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 0, y: 0, z: -1 }
    ];
    let owner = null;
    for (const off of adj) {
        const adjKey = keyFor({ x: pos.x + off.x, y: pos.y, z: pos.z + off.z });
        if (chestOwners.has(adjKey)) {
            owner = chestOwners.get(adjKey);
            break;
        }
    }

    // 2) If no neighbor and on cobblestone, lock to placer
    if (!owner && below.type.id === MinecraftBlockTypes.cobblestone.id) {
        owner = player.nameTag;
    }

    if (owner) {
        const myKey = keyFor(pos);
        chestOwners.set(myKey, owner);
        saveLocks();
        player.sendMessage(`🔒 Chest at ${myKey} locked to ${owner}`);
    }
});

// Prevent opening if not the owner
world.beforeEvents.playerInteractWithBlock.subscribe(ev => {
    if (ev.block.permutation.type.id !== MinecraftBlockTypes.chest.id) return;
    const key = keyFor(ev.block.location);
    const owner = chestOwners.get(key);
    if (owner && owner !== ev.player.nameTag) {
        ev.cancel = true;
        ev.player.sendMessage(`❌ Locked by ${owner}`);
    }
});

// Prevent breaking by non-owner, and clean up when the owner breaks
world.beforeEvents.blockBreak.subscribe(ev => {
    if (ev.block.permutation.type.id !== MinecraftBlockTypes.chest.id) return;
    const key = keyFor(ev.block.location);
    const owner = chestOwners.get(key);

    if (owner && owner !== ev.player.nameTag) {
        ev.cancel = true;
        ev.player.sendMessage(`❌ You cannot break ${owner}’s chest`);
    } else if (owner && owner === ev.player.nameTag) {
        chestOwners.delete(key);
        saveLocks();
    }
});

// Prevent explosions from destroying locked chests
world.beforeEvents.explosion.subscribe(ev => {
    ev.blockChanges = ev.blockChanges.filter(change =>
        !chestOwners.has(keyFor(change.location))
    );
});
