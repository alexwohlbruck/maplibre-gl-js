import {shaders} from '../shaders/shaders.ts';
import {Program} from './program.ts';
import {programUniforms} from './program/program_uniforms.ts';

import type {Context} from './context.ts';
import type {ProgramConfiguration} from '../data/program_configuration.ts';
import type {UniformBindings} from './uniform_binding.ts';
import type {ProjectionShaderVariant} from '../render/frame_render_context.ts';

type ProgramVariant = {
    name: string;
    programConfiguration?: ProgramConfiguration | null;
    projectionShaderVariant: ProjectionShaderVariant;
    showOverdrawInspector: boolean;
    useTerrain: boolean;
    defines: string[];
    /** Source set before the fragment shader's own, after the preludes: functions it calls. */
    fragmentChunk?: string;
};

/**
 * Programs that draw a style layer straight to the screen, which can skip a frame while they link. Programs that
 * fill a cached texture or a mask the next draw reads (prepare passes, clipping, depth, terrain, shading) link
 * at once, since a frame drawn without them would be kept.
 */
const DEFERRED_PROGRAMS = new Set([
    'background', 'backgroundPattern', 'circle', 'fill', 'fillOutline', 'fillOutlinePattern', 'fillPattern',
    'fillExtrusion', 'fillExtrusionPattern', 'line', 'lineVariableOffset', 'lineGradient', 'linePattern', 'lineSDF',
    'lineGradientSDF', 'raster', 'hillshade', 'colorRelief', 'symbolIcon', 'symbolSDF', 'symbolTextAndIcon'
]);

const chunkIds = new Map<string, number>();
/** A short name for a block of shader source, for the program cache's key. */
function chunkId(source: string): number {
    if (!chunkIds.has(source)) chunkIds.set(source, chunkIds.size + 1);
    return chunkIds.get(source);
}

/**
 * @internal
 * Compiles each shader variant the first time it is asked for and deletes all of them on destroy.
 */
export class ProgramCache {
    private readonly context: Context;
    private programs: Record<string, Program<UniformBindings>> = {};

    constructor(context: Context) {
        this.context = context;
    }

    /**
     * Returns the program for a shader variant, compiling it if the cache doesn't hold it yet.
     */
    getProgram(variant: ProgramVariant): Program<UniformBindings> {
        const configurationKey = (variant.programConfiguration ? variant.programConfiguration.cacheKey : '');
        const projectionKey = `/${variant.projectionShaderVariant.name}`;
        const overdrawKey = (variant.showOverdrawInspector ? '/overdraw' : '');
        const terrainKey = (variant.useTerrain ? '/terrain' : '');
        const definesKey = (variant.defines ? `/${variant.defines.join('/')}` : '') + (variant.fragmentChunk ? `/${chunkId(variant.fragmentChunk)}` : '');

        const key = variant.name + configurationKey + projectionKey + overdrawKey + terrainKey + definesKey;

        this.programs[key] ||= new Program(
            this.context,
            shaders[variant.name],
            variant.programConfiguration,
            programUniforms[variant.name],
            variant.showOverdrawInspector,
            variant.useTerrain,
            variant.projectionShaderVariant.prelude,
            variant.projectionShaderVariant.define,
            variant.defines,
            variant.fragmentChunk,
            DEFERRED_PROGRAMS.has(variant.name)
        );
        return this.programs[key];
    }

    destroy(): void {
        for (const program of Object.values(this.programs)) {
            if (program.program) {
                this.context.gl.deleteProgram(program.program);
            }
        }
        this.programs = {};
    }
}
