import { useEffect, useState } from 'react';

import { type MicPermission, micPermission, watchMicPermission } from './permission';

/** The current grant, tracked. Both halves are needed: the query for what is
 *  already true, the watcher for an answer given later — in a prompt, or in
 *  Chrome's settings long after this page was opened. */
export function useMicPermission(): MicPermission {
  const [permission, setPermission] = useState<MicPermission>('unknown');
  useEffect(() => {
    void micPermission().then(setPermission);
    return watchMicPermission(setPermission);
  }, []);
  return permission;
}
