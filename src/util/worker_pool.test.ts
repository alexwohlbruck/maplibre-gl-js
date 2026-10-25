import {describe, test, expect} from 'vitest';
import {WorkerPool} from './worker_pool.ts';

describe('WorkerPool', () => {
    test('acquire', async () => {
        Object.defineProperty(WorkerPool, 'workerCount', {value: 4});

        const pool = new WorkerPool();

        expect(pool.workersPromise).toBeFalsy();
        const workers1 = await pool.acquire('map-1');
        const workers2 = await pool.acquire('map-2');
        expect(workers1).toHaveLength(4);
        expect(workers2).toHaveLength(4);

        for (let i = 0; i < workers1.length; i++) {
            expect(workers1[i]).toBe(workers2[i]);
        }
    });

    test('release', async () => {
        let workersTerminated = 0;
        Object.defineProperty(WorkerPool, 'workerCount', {value: 4});

        const pool = new WorkerPool();
        await pool.acquire('map-1');
        const workers = await pool.acquire('map-2');
        for (const w of workers) {
            w.terminate = function () { workersTerminated += 1; };
        }

        pool.release('map-2');
        await Promise.resolve();

        expect(workersTerminated).toBe(0);
        expect(pool.workersPromise).toBeTruthy();

        pool.release('map-1');
        await Promise.resolve();
        expect(workersTerminated).toBe(4);
        expect(pool.workersPromise).toBeFalsy();
    });

    test('keeps one terrain worker apart from the tile workers, ended with the pool', async () => {
        Object.defineProperty(WorkerPool, 'workerCount', {value: 2});

        const pool = new WorkerPool();
        const workers = await pool.acquire('map-1');
        const terrain = await pool.acquireTerrain();
        expect(workers).not.toContain(terrain);
        expect(await pool.acquireTerrain()).toBe(terrain);

        let terminated = false;
        terrain.terminate = () => { terminated = true; };
        pool.release('map-1');
        await Promise.resolve();
        expect(terminated).toBe(true);
        expect(pool.terrainWorkerPromise).toBeFalsy();
    });
});
