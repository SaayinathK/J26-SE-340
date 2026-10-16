export function downloadFile(name, content, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function campaignCSV(campaigns) {
  const escape = value => {
    let text = value == null ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [['Campaign', 'Audience', 'Status', 'Emails sent', 'Open rate', 'Click rate'], ...campaigns.map(c => [c.name, c.audience, c.status, c.sent, c.open == null ? null : `${c.open}%`, c.click == null ? null : `${c.click}%`])].map(row => row.map(escape).join(',')).join('\r\n');
}
export const formatTime = value => value ? new Date(value).toLocaleString() : 'Not yet synced';

export function dailyCounts(records, days, now = new Date()) {
  const end = new Date(now); end.setUTCHours(0, 0, 0, 0);
  const bins = Array.from({ length: days }, (_, index) => ({ date: new Date(end.getTime() - (days - index - 1) * 86400000).toISOString().slice(0, 10), count: 0 }));
  const positions = new Map(bins.map((bin, index) => [bin.date, index]));
  for (const record of records) {
    const date = record.created_at?.slice(0, 10);
    if (positions.has(date)) bins[positions.get(date)].count += Number.isInteger(record.count) ? record.count : 1;
  }
  return bins;
}
