// A lock-screen teardown collapses this window to 0 height while it is still
// alive, so size and position read back then are not ours to trust.
export function windowSized(): boolean {
  return !!window.innerWidth && !!window.innerHeight;
}

export function windowCollapsed(): boolean {
  return document.hidden || !windowSized();
}
