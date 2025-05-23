import { UtxoService } from './palymra.utxo.service';
import { BlockFrostAPI } from '@blockfrost/blockfrost-js';

jest.mock('@blockfrost/blockfrost-js');
jest.mock('@nestjs/common', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        log: jest.fn(),
        error: jest.fn(),
    })),
}));
jest.mock('src/constants', () => ({
    BLOCKFROST_KEY: () => 'test-key',
}));

describe('UtxoService', () => {
    let utxoService: UtxoService;
    let mockBf: jest.Mocked<BlockFrostAPI>;

    beforeEach(() => {
        (BlockFrostAPI as jest.Mock).mockClear();
        utxoService = new UtxoService();
        mockBf = (utxoService as any).bf;
    });

    describe('flushMempool', () => {
        it('should fetch all mempool transactions and call mempoolTx for each', async () => {
            // Arrange
            const mempoolPages = [
                // page 1: 100 txs
                Array.from({ length: 100 }, (_, i) => ({ tx_hash: `hash${i}` })),
                // page 2: 50 txs
                Array.from({ length: 50 }, (_, i) => ({ tx_hash: `hash${i + 100}` })),
                // page 3: empty
                [],
            ];
            let pageCall = 0;
            mockBf.mempool = jest.fn().mockImplementation(({ page }) => {
                return Promise.resolve(mempoolPages[page - 1]);
            });
            mockBf.mempoolTx = jest.fn().mockImplementation(async (hash) => ({ hash }));

            // Act
            const result = await utxoService.flushMempool();

            // Assert
            expect(mockBf.mempool).toHaveBeenCalledTimes(3);
            expect(mockBf.mempool).toHaveBeenNthCalledWith(1, { page: 1 });
            expect(mockBf.mempool).toHaveBeenNthCalledWith(2, { page: 2 });
            expect(mockBf.mempool).toHaveBeenNthCalledWith(3, { page: 3 });

            // Should call mempoolTx for all 150 hashes
            expect(mockBf.mempoolTx).toHaveBeenCalledTimes(150);
            for (let i = 0; i < 150; i++) {
                expect(mockBf.mempoolTx).toHaveBeenCalledWith(`hash${i}`);
            }

            // Result is an array of promises, resolve them
            const resolved = await Promise.all(result);
            expect(resolved).toHaveLength(150);
            expect(resolved[0]).toEqual({ hash: 'hash0' });
            expect(resolved[149]).toEqual({ hash: 'hash149' });
        });

        it('should return empty array if mempool is empty', async () => {
            mockBf.mempool = jest.fn().mockResolvedValue([]);
            mockBf.mempoolTx = jest.fn();

            const result = await utxoService.flushMempool();

            expect(mockBf.mempool).toHaveBeenCalledTimes(1);
            expect(mockBf.mempoolTx).not.toHaveBeenCalled();
            expect(result).toEqual([]);
        });

        it('should handle single page with less than 100 txs', async () => {
            mockBf.mempool = jest.fn().mockResolvedValue([
                { tx_hash: 'hash1' },
                { tx_hash: 'hash2' },
            ]);
            mockBf.mempoolTx = jest.fn().mockImplementation(async (hash) => ({ hash }));

            const result = await utxoService.flushMempool();

            expect(mockBf.mempool).toHaveBeenCalledTimes(1);
            expect(mockBf.mempoolTx).toHaveBeenCalledTimes(2);
            expect(await Promise.all(result)).toEqual([{ hash: 'hash1' }, { hash: 'hash2' }]);
        });
    });
});