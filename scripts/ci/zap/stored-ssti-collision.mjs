// ZAP's Django-addition probe can mistake a number inside another stored
// probe for an evaluated result. Accept only that demonstrable collision.
export function isStoredAdditionCollision(instance) {
  if (instance.param !== 'eventTypes[0]' || instance.evidence !== '')
    return false;
  const attack = /^zj\{\{(\d{1,9})\|add:(\d{1,9})\}\}zj$/.exec(
    instance.attack ?? '',
  );
  const proof =
    /^Proof found at \[([^\]\r\n]+)\]\r?\ncontent:\r?\n([\s\S]+)$/.exec(
      instance.otherinfo ?? '',
    );
  if (!attack || !proof) return false;
  try {
    const target = new URL(instance.uri);
    const source = new URL(proof[1]);
    if (!/^\/admin\/realms\/[^/]+\/webhooks\/?$/.test(target.pathname))
      return false;
    if (
      target.origin !== source.origin ||
      source.pathname !== target.pathname.replace(/webhooks\/?$/, 'export')
    )
      return false;
  } catch {
    return false;
  }
  const expected = String(Number(attack[1]) + Number(attack[2]));
  const content = proof[2];
  // Require the original probe verbatim and the alleged computed number.
  // Remove ONLY unevaluated addition probes. Any remaining occurrence of
  // the computed value (including a real evaluation) keeps the alert open.
  return (
    content.includes(instance.attack) &&
    content.includes(expected) &&
    !content.replace(/zj\{\{\d{1,9}\|add:\d{1,9}\}\}zj/g, '').includes(expected)
  );
}
