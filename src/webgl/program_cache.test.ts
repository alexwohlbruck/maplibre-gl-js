import {describe, test, expect, beforeEach, vi} from 'vitest';
import {Context} from './context.ts';
import {ProgramCache} from './program_cache.ts';
import {shaders} from '../shaders/shaders.ts';
import {createNullGL} from '../util/test/null_gl.ts';

describe('ProgramCache', () => {
    const clippingMaskVariant = {
        name: 'clippingMask',
        programConfiguration: null,
        projectionShaderVariant: {name: 'mercator', define: '#define PROJECTION_MERCATOR', prelude: shaders.projectionMercator},
        showOverdrawInspector: false,
        useTerrain: false,
        defines: []
    };
    let gl: WebGL2RenderingContext;
    let cache: ProgramCache;

    beforeEach(() => {
        gl = createNullGL();
        cache = new ProgramCache(new Context(gl));
    });

    test('returns the same program for the same variant without compiling again', () => {
        const program = cache.getProgram(clippingMaskVariant);

        const cachedProgram = cache.getProgram({...clippingMaskVariant});

        expect(cachedProgram).toBe(program);
        expect(gl.createProgram).toHaveBeenCalledTimes(1);
    });

    test('compiles a new program for a different variant', () => {
        const program = cache.getProgram(clippingMaskVariant);

        const terrainProgram = cache.getProgram({...clippingMaskVariant, useTerrain: true});

        expect(terrainProgram).not.toBe(program);
        expect(gl.createProgram).toHaveBeenCalledTimes(2);
    });

    test('compiles a program per shader, projection variant, overdraw switch and list of defines', () => {
        const globeVariant = {name: 'globe', define: '#define GLOBE', prelude: shaders.projectionGlobe};
        cache.getProgram(clippingMaskVariant);

        cache.getProgram({...clippingMaskVariant, name: 'background'});
        cache.getProgram({...clippingMaskVariant, projectionShaderVariant: globeVariant});
        cache.getProgram({...clippingMaskVariant, showOverdrawInspector: true});
        cache.getProgram({...clippingMaskVariant, defines: ['#define A']});

        expect(gl.createProgram).toHaveBeenCalledTimes(5);
    });

    test('compiles a program per fragment chunk, with or without defines', () => {
        const program = cache.getProgram(clippingMaskVariant);

        const chunkProgram = cache.getProgram({...clippingMaskVariant, fragmentChunk: 'float a() { return 1.0; }'});
        const otherChunkProgram = cache.getProgram({...clippingMaskVariant, fragmentChunk: 'float a() { return 2.0; }'});
        cache.getProgram({...clippingMaskVariant, defines: ['#define A'], fragmentChunk: 'float a() { return 1.0; }'});

        expect(chunkProgram).not.toBe(program);
        expect(otherChunkProgram).not.toBe(chunkProgram);
        expect(cache.getProgram({...clippingMaskVariant, fragmentChunk: 'float a() { return 1.0; }'})).toBe(chunkProgram);
        expect(gl.createProgram).toHaveBeenCalledTimes(4);
    });

    test('destroy deletes every program in the order they were compiled', () => {
        const terrainProgram = cache.getProgram({...clippingMaskVariant, useTerrain: true});
        const backgroundProgram = cache.getProgram({...clippingMaskVariant, name: 'background'});
        const program = cache.getProgram(clippingMaskVariant);

        cache.destroy();

        expect(vi.mocked(gl.deleteProgram).mock.calls).toEqual([[terrainProgram.program], [backgroundProgram.program], [program.program]]);
    });
});
