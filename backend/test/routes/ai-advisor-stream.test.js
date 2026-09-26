const { callClaudeStream } = require('../../src/routes/ai-advisor');

const encoder = new TextEncoder();
const frame = (data) => encoder.encode(`event: x\ndata: ${JSON.stringify(data)}\n\n`);

// A fetch mock whose body yields the given chunks, each after `gapMs` of (fake) time, and then
// either ends or stalls forever. A stalled read rejects once the request's signal aborts, like
// a real fetch body does.
function mockStream(chunks, { gapMs, stallAtEnd }) {
  vi.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
    let i = 0;
    return {
      ok: true,
      body: {
        getReader: () => ({
          read() {
            return new Promise((resolve, reject) => {
              const onAbort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
              if (init.signal.aborted) return onAbort();
              init.signal.addEventListener('abort', onAbort, { once: true });
              if (i >= chunks.length) {
                if (stallAtEnd) return; // never resolves on its own
                return resolve({ done: true, value: undefined });
              }
              setTimeout(() => {
                init.signal.removeEventListener('abort', onAbort);
                resolve({ done: false, value: chunks[i++] });
              }, gapMs);
            });
          },
        }),
      },
    };
  });
}

const args = { model: 'claude-opus-5', system: 's', messages: [{ role: 'user', content: 'q' }], maxTokens: 100, apiKey: 'k' };

describe('callClaudeStream idle timeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps a slow but steady stream alive well past the old 3-minute total limit', async () => {
    const deltas = Array.from({ length: 5 }, () =>
      frame({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'ab' } })
    );
    mockStream([...deltas, frame({ type: 'message_delta', delta: { stop_reason: 'end_turn' } })], { gapMs: 60000 });

    const promise = callClaudeStream(args);
    await vi.advanceTimersByTimeAsync(6 * 60000);

    await expect(promise).resolves.toMatchObject({ text: 'ababababab' });
  });

  it('abandons a stream that goes silent, with an explanatory error', async () => {
    mockStream([frame({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'a' } })], { gapMs: 10, stallAtEnd: true });

    const promise = callClaudeStream(args);
    const assertion = expect(promise).rejects.toThrow(/stopped sending data for 120 seconds/);
    await vi.advanceTimersByTimeAsync(121000);

    await assertion;
  });

  it('reports a response cut short by the token limit', async () => {
    mockStream([frame({ type: 'message_delta', delta: { stop_reason: 'max_tokens' } })], { gapMs: 10 });

    const promise = callClaudeStream(args);
    const assertion = expect(promise).rejects.toThrow(/token limit/);
    await vi.advanceTimersByTimeAsync(100);

    await assertion;
  });
});
