// Offsets refer to the saved text, before recipient placeholders are rendered.
export function flaggedSegments(value, flags, emailIndex, field) {
  const occurrences = flags.filter(flag => flag.email_index === emailIndex)
    .flatMap(flag => (flag.occurrences || []).filter(item => item.field === field).map(item => ({ ...item, detail:flag.detail })));
  const segments = [];
  let start = 0;
  const append = end => {
    const reasons = [...new Set(occurrences.filter(item => item.start < end && item.end > start).map(item => item.detail))];
    segments.push({ text:value.slice(start,end), reasons });
    start = end;
  };
  for (const match of value.matchAll(/\n|[.!?](?=\s|$)/g)) append(match.index + match[0].length);
  if (start < value.length) append(value.length);
  return segments;
}
