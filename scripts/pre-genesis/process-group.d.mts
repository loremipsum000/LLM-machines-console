export function signalOwnedProcessGroup(
  pid: number | undefined,
  signal: NodeJS.Signals | 0,
  ownerHasExited: () => boolean,
  signalProcess?: (pid: number, signal: NodeJS.Signals | 0) => boolean,
): boolean
