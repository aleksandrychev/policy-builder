import { makeStore } from '../store/test/storeTestUtils';
import { createNginxDemoProject } from './nginxDemoProject';

function buildDemo() {
  const store = makeStore();
  createNginxDemoProject(store.dispatch);
  return store.getState();
}

describe('createNginxDemoProject', () => {
  it('builds three files of blocks, opened on Webserver', () => {
    const { canvas, files, testEnvironments } = buildDemo();
    expect(files.files.map(file => file.name)).toEqual(['Common', 'Webserver', 'Security']);
    expect(files.files.find(file => file.id === files.currentFileId)?.name).toBe('Webserver');
    expect(files.files.every(file => canvas.some(block => block.fileId === file.id))).toBe(true);
    expect(testEnvironments.map(environment => environment.id)).toEqual(['demo-web-server']);
  });

  it('places every block somewhere of its own', () => {
    const { canvas } = buildDemo();
    for (const block of canvas) {
      expect(block.position, block.label).toBeDefined();
      expect(block.position, block.label).not.toEqual({ x: 0, y: 0 });
    }
  });

  it('describes each file in at most 5 sentences', () => {
    const { files } = buildDemo();
    for (const file of files.files) {
      const sentences = file.description?.split(/[.!?](?:\s|$)/).filter(sentence => sentence.trim()) ?? [];
      expect(sentences.length, file.name).toBeGreaterThan(0);
      expect(sentences.length, file.name).toBeLessThanOrEqual(5);
    }
  });
});
