// Route handler. These may run on serverless or edge, where nothing drains the
// queue for you — so flush before returning. `flush()` on an empty queue is
// effectively free, so an unconditional `finally` is the right shape.
import bugboard from '@/lib/bugboard.server';

export async function POST(request: Request) {
  try {
    return Response.json(await processCheckout(await request.json()));
  } catch (err) {
    bugboard.criticalHigh('Checkout API failed', err, ['api', 'checkout']);
    return Response.json({ error: 'Checkout failed' }, { status: 500 });
  } finally {
    await bugboard.flush();
  }
}

// Your business logic.
declare function processCheckout(body: unknown): Promise<unknown>;
