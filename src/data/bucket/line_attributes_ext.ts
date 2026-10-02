import {createLayout, type StructArrayLayout, type StructArrayMember} from '../../util/struct_array.ts';

export const lineLayoutAttributesExt: StructArrayLayout = createLayout([
    {name: 'a_uv_x', components: 1, type: 'Float32'},
    {name: 'a_split_index', components: 1, type: 'Float32'},
    // Per-vertex line offset (pixels), evaluated from a `line-progress` expression on
    // `line-offset`. Only populated (non-zero) when the offset varies along the line;
    // consumed by the `lineVariableOffset` shader variant.
    {name: 'a_line_offset', components: 1, type: 'Float32'},
]);

export const members: StructArrayMember[] = lineLayoutAttributesExt.members;
export const size: number = lineLayoutAttributesExt.size;
export const alignment: number = lineLayoutAttributesExt.alignment;
