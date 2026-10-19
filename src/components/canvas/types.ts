export type HandleKind =
  | { type: 'point-move' }
  | { type: 'line-end'; index: 0 | 1 }
  | { type: 'rect-corner'; cornerIndex: 0 | 1 | 2 | 3 }
  | { type: 'rect-rotate' }
  | { type: 'circle-radius' }
  | { type: 'polygon-vertex'; index: number }
  | { type: 'polygon-rotate' }
  | { type: 'translate' };

export type Handle = {
  kind: HandleKind;
  world: [number, number];
};

export type View = {
  centerX: number;
  centerY: number;
  scale: number;
};

export type Size = {
  width: number;
  height: number;
};
