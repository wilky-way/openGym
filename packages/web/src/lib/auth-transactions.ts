import { useStore } from '../store/useStore'
import type { AuthTransaction, AuthenticatedUser } from '../store/sync-engine'
/** All cookie/bearer installation belongs inside the store's held auth transaction. */
export async function authenticate(
  exchange: () => Promise<AuthenticatedUser>,
  valid: () => boolean,
  options?: Parameters<AuthTransaction['commit']>[2],
) {
  const begin = useStore.getState().beginAuthTransaction
  if (!begin) throw new Error('Authentication is not initialized')
  const transaction = await begin()
  try { return await transaction.commit(exchange, valid, options) }
  finally { transaction.cancel() }
}
