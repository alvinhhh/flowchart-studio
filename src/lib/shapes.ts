export const NODE_TYPES = [
  'terminal', 'process', 'decision', 'io', 'function', 'note',
  'alternate_process', 'internal_storage', 'document', 'multi_document',
  'preparation', 'manual_input', 'manual_operation', 'connector', 'off_page',
  'card', 'paper_tape', 'summing_junction', 'or', 'collate', 'sort', 'extract',
  'merge', 'stored_data', 'delay', 'sequential_data', 'database', 'direct_data',
  'display', 'annotation', 'loop_limit', 'parallel',
  'octagon', 'star', 'cloud', 'cross', 'speech_bubble',
  'arrow_right', 'arrow_left', 'arrow_up', 'arrow_down', 'arrow_horizontal', 'arrow_vertical', 'chevron',
] as const;

export type NodeKind = (typeof NODE_TYPES)[number];
export type ShapeGroup = 'Basic' | 'Process' | 'Data' | 'Routing' | 'Geometry' | 'Block arrows';
export interface NodeDefinition {
  label: string;
  group: ShapeGroup;
  width: number;
  height: number;
  defaultLabel?: string;
  keywords: string;
}

export const NODE_TYPE_LABELS: Record<NodeKind, string> = {
  terminal: 'Start / End', process: 'Process', decision: 'Decision', io: 'Input / Output', function: 'Function', note: 'Note',
  alternate_process: 'Alternate process', internal_storage: 'Internal storage', document: 'Document', multi_document: 'Multiple documents',
  preparation: 'Preparation', manual_input: 'Manual input', manual_operation: 'Manual operation', connector: 'Connector', off_page: 'Off-page connector',
  card: 'Card', paper_tape: 'Paper tape', summing_junction: 'Summing junction', or: 'Or junction', collate: 'Collate', sort: 'Sort', extract: 'Extract',
  merge: 'Merge', stored_data: 'Stored data', delay: 'Delay', sequential_data: 'Sequential data', database: 'Database', direct_data: 'Direct-access data',
  display: 'Display', annotation: 'Annotation', loop_limit: 'Loop limit', parallel: 'Parallel mode',
  octagon: 'Octagon', star: 'Star', cloud: 'Cloud', cross: 'Cross', speech_bubble: 'Speech bubble',
  arrow_right: 'Right arrow', arrow_left: 'Left arrow', arrow_up: 'Up arrow', arrow_down: 'Down arrow',
  arrow_horizontal: 'Left-right arrow', arrow_vertical: 'Up-down arrow', chevron: 'Chevron',
};

function definition(kind: NodeKind, group: ShapeGroup, width: number, height: number, keywords: string, defaultLabel?: string): NodeDefinition {
  return { label: NODE_TYPE_LABELS[kind], group, width, height, keywords, ...(defaultLabel !== undefined ? { defaultLabel } : {}) };
}

export const NODE_DEFINITIONS: Record<NodeKind, NodeDefinition> = {
  terminal: definition('terminal', 'Basic', 176, 80, 'start end stop terminator terminal begin finish'),
  process: definition('process', 'Basic', 176, 80, 'process action step task operation rectangle'),
  decision: definition('decision', 'Basic', 180, 120, 'decision condition branch yes no diamond if'),
  io: definition('io', 'Basic', 176, 80, 'input output data io parallelogram'),
  function: definition('function', 'Basic', 176, 80, 'function predefined process subroutine procedure call'),
  note: definition('note', 'Basic', 176, 100, 'note comment folded corner'),
  alternate_process: definition('alternate_process', 'Process', 184, 88, 'alternate alternative process action rounded rectangle'),
  internal_storage: definition('internal_storage', 'Data', 184, 104, 'internal storage memory internal process'),
  document: definition('document', 'Data', 184, 112, 'document page report file wave'),
  multi_document: definition('multi_document', 'Data', 200, 136, 'multiple documents multidocument pages stack reports'),
  preparation: definition('preparation', 'Process', 184, 96, 'preparation initialize initialization setup hexagon'),
  manual_input: definition('manual_input', 'Data', 184, 104, 'manual input keyboard user entry'),
  manual_operation: definition('manual_operation', 'Process', 184, 104, 'manual operation human task trapezoid'),
  connector: definition('connector', 'Routing', 72, 72, 'connector on page connection circle reference', 'A'),
  off_page: definition('off_page', 'Routing', 112, 112, 'off page connector reference continuation pentagon', 'A'),
  card: definition('card', 'Data', 184, 104, 'card punched punch card cut corner'),
  paper_tape: definition('paper_tape', 'Data', 192, 112, 'paper tape punched tape wave'),
  summing_junction: definition('summing_junction', 'Routing', 72, 72, 'summing junction sum and junction cross', ''),
  or: definition('or', 'Routing', 72, 72, 'or junction choice plus', ''),
  collate: definition('collate', 'Routing', 144, 140, 'collate arrange organize hourglass'),
  sort: definition('sort', 'Routing', 160, 140, 'sort order diamond divided'),
  extract: definition('extract', 'Routing', 152, 128, 'extract extraction triangle'),
  merge: definition('merge', 'Routing', 152, 128, 'merge combine inverted triangle'),
  stored_data: definition('stored_data', 'Data', 192, 104, 'stored data storage offline data'),
  delay: definition('delay', 'Process', 184, 96, 'delay wait pause timer'),
  sequential_data: definition('sequential_data', 'Data', 160, 136, 'sequential data access magnetic tape reel'),
  database: definition('database', 'Data', 160, 128, 'database cylinder magnetic disk disc sql storage'),
  direct_data: definition('direct_data', 'Data', 200, 104, 'direct access data storage disk cylinder'),
  display: definition('display', 'Data', 192, 104, 'display screen monitor output'),
  annotation: definition('annotation', 'Data', 200, 112, 'annotation comment explanation bracket'),
  loop_limit: definition('loop_limit', 'Process', 184, 104, 'loop limit loop boundary repeat iteration'),
  parallel: definition('parallel', 'Routing', 192, 96, 'parallel mode concurrent fork join synchronization'),
  octagon: definition('octagon', 'Geometry', 160, 144, 'octagon eight sided polygon stop'),
  star: definition('star', 'Geometry', 160, 152, 'star five pointed priority highlight'),
  cloud: definition('cloud', 'Geometry', 200, 128, 'cloud network internet external service'),
  cross: definition('cross', 'Geometry', 148, 148, 'cross plus addition medical'),
  speech_bubble: definition('speech_bubble', 'Geometry', 200, 136, 'speech bubble callout chat comment conversation', 'Callout'),
  arrow_right: definition('arrow_right', 'Block arrows', 192, 104, 'right arrow block forward next direction'),
  arrow_left: definition('arrow_left', 'Block arrows', 192, 104, 'left arrow block back previous direction'),
  arrow_up: definition('arrow_up', 'Block arrows', 128, 184, 'up arrow block north direction'),
  arrow_down: definition('arrow_down', 'Block arrows', 128, 184, 'down arrow block south direction'),
  arrow_horizontal: definition('arrow_horizontal', 'Block arrows', 208, 112, 'left right arrow block horizontal bidirectional both double', 'Both ways'),
  arrow_vertical: definition('arrow_vertical', 'Block arrows', 128, 192, 'up down arrow block vertical bidirectional both double', 'Both ways'),
  chevron: definition('chevron', 'Block arrows', 192, 112, 'chevron arrow block step progress direction'),
};
