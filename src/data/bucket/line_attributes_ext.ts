import {createLayout} from '../../util/struct_array';

export const lineLayoutAttributesExt = createLayout([
    {name: 'a_uv_x', components: 1, type: 'Float32'},
    {name: 'a_split_index', components: 1, type: 'Float32'},
    // Per-vertex line offset (pixels), evaluated from a `line-progress` expression on
    // `line-offset`. Only populated (non-zero) when the offset varies along the line;
    // consumed by the `lineVariableOffset` shader variant.
    {name: 'a_line_offset', components: 1, type: 'Float32'},
]);

export const {members, size, alignment} = lineLayoutAttributesExt;
