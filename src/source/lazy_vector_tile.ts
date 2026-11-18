import {PbfReader} from 'pbf';
import {VectorTileLayer} from '@mapbox/vector-tile';

import type {VectorTileLayerLike} from '@maplibre/vt-pbf';

const LAYER_TAG = 3;
const NAME_TAG = 1;
const LENGTH_DELIMITED = 2;

/** The name of the layer message starting at the reader's position, which is left where it was. */
function layerName(pbf: PbfReader, end: number): string {
    const start = pbf.pos;
    let name = '';
    while (pbf.pos < end) {
        const key = pbf.readVarint();
        if (key >> 3 === NAME_TAG) {
            name = pbf.readString();
            break;
        }
        pbf.skip(key);
    }
    pbf.pos = start;
    return name;
}

/**
 * A vector tile's layers by name, each one parsed when it is first read. Parsing a layer decodes every key
 * and value it holds, so a query or a feature-state update that wants one layer of a large tile no longer
 * pays for all of them on the main thread.
 */
export function lazyVectorTileLayers(data: ArrayBuffer | Uint8Array): {[_: string]: VectorTileLayerLike} {
    const pbf = new PbfReader(data);
    const layers: {[_: string]: VectorTileLayerLike} = {};
    while (pbf.pos < pbf.length) {
        const key = pbf.readVarint();
        if (key >> 3 !== LAYER_TAG || (key & 7) !== LENGTH_DELIMITED) {
            pbf.skip(key);
            continue;
        }
        const end = pbf.readVarint() + pbf.pos;
        const start = pbf.pos;
        const name = layerName(pbf, end);
        pbf.pos = end;
        if (!name) continue;
        let layer: VectorTileLayerLike;
        Object.defineProperty(layers, name, {
            enumerable: true,
            configurable: true,
            get: () => {
                if (!layer) {
                    const reader = new PbfReader(data);
                    reader.pos = start;
                    layer = new VectorTileLayer(reader, end);
                }
                return layer;
            },
        });
    }
    return layers;
}
