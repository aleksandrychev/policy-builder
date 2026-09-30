import type { BlockInstance, Condition } from '../store/canvasSlice/types';
import { GATE_LIFT, GATE_NODE_PREFIX, GATE_SPACE, deriveGates, gateKey } from './gates';

const ifClass = (className: string): Condition => ({ kind: 'class', mode: 'if', className });
const unlessClass = (className: string): Condition => ({ kind: 'class', mode: 'unless', className });

const block = (instanceId: string, x: number, y: number, condition?: Condition): BlockInstance => ({
  blockId: 'report-message',
  condition,
  fileId: 'f1',
  instanceId,
  label: instanceId,
  params: {},
  position: { x, y }
});

describe('gateKey', () => {
  it('keys a chosen class by file, mode and class', () => {
    expect(gateKey('f1', 'a', ifClass('linux'))).toBe(gateKey('f1', 'b', ifClass('linux')));
    expect(gateKey('f1', 'a', ifClass('linux'))).not.toBe(gateKey('f1', 'a', unlessClass('linux')));
    expect(gateKey('f1', 'a', ifClass('linux'))).not.toBe(gateKey('f2', 'a', ifClass('linux')));
  });

  it('keys a condition with no class yet by its block', () => {
    expect(gateKey('f1', 'a', ifClass(''))).not.toBe(gateKey('f1', 'b', ifClass('')));
  });
});

describe('deriveGates', () => {
  it('draws one gate per distinct mode + class, linked to every block carrying it', () => {
    const gates = deriveGates(
      [block('a', 0, 0, ifClass('linux')), block('b', 0, 200, ifClass('linux')), block('c', 0, 400, unlessClass('linux')), block('d', 0, 600)],
      'f1',
      {}
    );
    expect(gates).toHaveLength(2);
    const linux = gates.find(gate => gate.condition.mode === 'if')!;
    expect(linux.instanceIds).toEqual(['a', 'b']);
    expect(linux.nodeId).toBe(`${GATE_NODE_PREFIX}${linux.key}`);
    expect(gates.find(gate => gate.condition.mode === 'unless')!.instanceIds).toEqual(['c']);
  });

  it('gives each pending (class not chosen) condition its own gate', () => {
    const gates = deriveGates([block('a', 0, 0, ifClass('')), block('b', 0, 200, ifClass(''))], 'f1', {});
    expect(gates.map(gate => gate.instanceIds)).toEqual([['a'], ['b']]);
  });

  it('sits left of the leftmost gated block, level with the highest one, on the grid', () => {
    const [gate] = deriveGates([block('low', 400, 300, ifClass('linux')), block('high', 407, 103, ifClass('linux'))], 'f1', {});
    expect(gate.position.y).toBe(100);
    expect(gate.position.x).toBe(400 - GATE_SPACE);
    expect(gate.position.x % 20).toBe(0);
  });

  it('keeps a stored (dragged) position', () => {
    const key = gateKey('f1', 'a', ifClass('linux'));
    const [gate] = deriveGates([block('a', 400, 100, ifClass('linux'))], 'f1', { [key]: { x: 13, y: 17 } });
    expect(gate.position).toEqual({ x: 13, y: 17 });
  });

  it('lifts above the block when its data chains take the spot beside it', () => {
    const instances = [block('a', 400, 400, ifClass('linux'))];
    const [plain] = deriveGates(instances, 'f1', {});
    const [lifted] = deriveGates(instances, 'f1', {}, () => true);
    expect(lifted.position.x).toBe(plain.position.x);
    expect(plain.position.y - lifted.position.y).toBe(GATE_LIFT);
  });
});
