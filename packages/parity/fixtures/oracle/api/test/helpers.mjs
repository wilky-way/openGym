/* Shared server readiness helper for API integration tests. */

/* The port a spawned server.js actually bound.
 *
 * Never pick one for it. Opening a listener on 0, reading the port, closing it and handing the
 * number to a child that binds it a process start later leaves a window the kernel re-issues
 * ephemeral ports inside -- 8 repeats in 400 open/close rounds on this box -- and a dozen test
 * files spawn servers at once, so two draw the same number, one child loses the bind and dies,
 * and the other file's server answers on it: a different data dir, a db.json without the test's
 * user, and a 401 where the answer belongs. It cost one unreproducible failure before anyone
 * looked.
 *
 * So the child picks its own port (PORT=0) and says which on its boot line. That line cannot be
 * printed before the socket is bound, which makes it the readiness signal as well -- no polling
 * /api/health, and no waiting on a server that died at boot either.
 *
 * `tail` supplies whatever the caller has collected of the child's output, for the message.
 */
export function boundPort(child, tail = () => '') {
  return new Promise((resolve, reject) => {
    let seen = '';
    const give = setTimeout(() => reject(new Error(`server never announced a port:\n${tail() || seen}`)), 20000);
    const look = d => {
      seen += d;
      const m = /gym-api on :(\d+)/.exec(seen);
      if (!m) return;
      clearTimeout(give);
      child.stdout.off('data', look);
      resolve(+m[1]);
    };
    child.stdout.on('data', look);
    child.once('exit', code => { clearTimeout(give); reject(new Error(`server exited (${code}):\n${tail() || seen}`)); });
  });
}
