import {describe, test, expect, beforeEach, vi} from 'vitest';
import {Context} from './context.ts';
import {ProgramCache} from './program_cache.ts';
import {shaders} from '../shaders/shaders.ts';
import {createNullGL} from '../util/test/null_gl.ts';

describe('Program', () => {
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

    test('a dead GPU process is tolerated while isContextLost() still reports live (Chromium link failure, #8607)', () => {
        vi.mocked(gl.getProgramParameter).mockReturnValue(0);
        vi.mocked(gl.getShaderParameter).mockReturnValue(false);

        const program = cache.getProgram(clippingMaskVariant);

        expect(program.failedToCreate).toBe(true);
    });

    test('a link failure on a live GPU still throws, with an empty info log included', () => {
        vi.mocked(gl.getProgramParameter).mockImplementation((_program, pname) => {
            if (pname === gl.LINK_STATUS) return false;
            if (pname === gl.ATTACHED_SHADERS) return 2;
            return true;
        });

        expect(() => cache.getProgram(clippingMaskVariant)).toThrow('Program failed to link');
    });

    describe('with parallel shader compilation', () => {
        const COMPLETION_STATUS_KHR = 0x91B1;
        const fillVariant = {...clippingMaskVariant, name: 'fill'};
        let context: Context;
        let linked: boolean;

        beforeEach(() => {
            linked = false;
            vi.mocked(gl.getExtension).mockImplementation(((name: string) => (name === 'KHR_parallel_shader_compile' ? {COMPLETION_STATUS_KHR} : null)) as any);
            vi.mocked(gl.getProgramParameter).mockImplementation((_program, pname) => (pname === COMPLETION_STATUS_KHR ? linked : true));
            context = new Context(gl);
            cache = new ProgramCache(context);
        });

        test('a layer program reads nothing from the driver until it reports the link complete', () => {
            const program = cache.getProgram(fillVariant);

            expect(program.isReady()).toBe(false);
            expect(context.programsPending).toBe(true);
            expect(gl.getUniformLocation).not.toHaveBeenCalled();

            linked = true;
            expect(program.isReady()).toBe(true);
            expect(gl.getUniformLocation).toHaveBeenCalled();
            expect(program.fixedUniforms).toBeDefined();
        });

        test('a mask program links at once, since a frame drawn without it would be kept', () => {
            const program = cache.getProgram(clippingMaskVariant);

            expect(gl.getUniformLocation).toHaveBeenCalled();
            expect(program.isReady()).toBe(true);
            expect(context.programsPending).toBe(false);
        });
    });
});
