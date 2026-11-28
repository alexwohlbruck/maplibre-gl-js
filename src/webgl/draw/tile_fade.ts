import type {StyleLayer} from '../../style/style_layer.ts';
import type {TileManager} from '../../tile/tile_manager.ts';
import type {Tile} from '../../tile/tile.ts';

/** Generations of parents a tile looks through for one already drawing its layer. */
const PARENT_DEPTH = 4;
/** Milliseconds a tile may go undrawn before its fade is forgotten, so one that comes back from the cache fades in again. */
const FORGET_AFTER = 3000;

/** The milliseconds a layer's content takes to fade in on a newly arrived tile, from metadata `parchment:tile-fade`; 0 for none. */
export function tileFadeDuration(layer: StyleLayer): number {
    const value = (layer.metadata as Record<string, unknown> | undefined)?.['parchment:tile-fade'];
    return typeof value === 'number' && value > 0 ? value : 0;
}

/** The shader define for a layer that fades in by tile. */
export function tileFadeDefines(layer: StyleLayer): string[] {
    return tileFadeDuration(layer) ? ['#define TILE_FADE'] : [];
}

type Fade = {start: number; seen: number};

/**
 * When each tile first drew each fading layer, so its content eases in rather than appearing whole. A tile that
 * takes over from a loaded parent or child already drawing the layer does not fade: that area was never empty.
 */
export class TileFades {
    private fades = new Map<string, Map<string, Fade>>();
    /** When each source tile is done fading, by `source/tile key`, for the drape's fingerprints. */
    private ends = new Map<string, number>();
    private now = 0;
    private frame = 0;
    private prunedAt = 0;
    /** Whether any tile drew mid-fade this frame, so the map draws another. */
    fading = false;

    beginFrame(now: number): void {
        this.now = now;
        this.frame++;
        this.fading = false;
        if (now - this.prunedAt < FORGET_AFTER) return;
        this.prunedAt = now;
        for (const [layerId, byTile] of this.fades) {
            for (const [key, fade] of byTile) if (now - fade.seen > FORGET_AFTER) byTile.delete(key);
            if (!byTile.size) this.fades.delete(layerId);
        }
        for (const [key, end] of this.ends) if (end < now) this.ends.delete(key);
    }

    /** How far the tile's content for the layer has faded in, 0-1; 1 for a layer that does not fade. */
    factor(layer: StyleLayer, tileManager: TileManager, tile: Tile): number {
        const duration = tileFadeDuration(layer);
        if (!duration) return 1;
        let byTile = this.fades.get(layer.id);
        if (!byTile) this.fades.set(layer.id, byTile = new Map());
        const key = tile.tileID.key;
        let fade = byTile.get(key);
        if (!fade) {
            fade = {start: alreadyDrawn(layer, tileManager, tile) ? -Infinity : this.now, seen: this.now};
            byTile.set(key, fade);
            if (fade.start === this.now) this.ends.set(`${tileManager.id}/${key}`, this.now + duration);
        }
        fade.seen = this.now;
        const t = (this.now - fade.start) / duration;
        if (t >= 1) return 1;
        this.fading = true;
        return t * t * (3 - 2 * t);
    }

    /** A stamp that changes every frame while any of the source tiles is fading, and is 0 once none is. */
    stamp(sourceId: string, tileKeys: Iterable<string>): number {
        for (const key of tileKeys) if ((this.ends.get(`${sourceId}/${key}`) ?? 0) > this.now) return this.frame;
        return 0;
    }
}

/** Whether a loaded parent or child of the tile already has the layer's data, and so has been standing in for it. */
function alreadyDrawn(layer: StyleLayer, tileManager: TileManager, tile: Tile): boolean {
    const id = tile.tileID;
    for (let z = id.overscaledZ - 1; z >= Math.max(0, id.overscaledZ - PARENT_DEPTH); z--) {
        if (tileManager.getLoadedTile(id.scaledTo(z))?.getBucket(layer)) return true;
    }
    for (const key of tileManager.getIds()) {
        const other = tileManager.getTileByID(key);
        if (other !== tile && other?.hasData() && !other.awaitingUpload && other.tileID.isChildOf(id) && other.getBucket(layer)) return true;
    }
    return false;
}
