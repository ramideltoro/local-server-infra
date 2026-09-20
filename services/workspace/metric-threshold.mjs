// A metric name alone cannot identify its unit: free-memory bytes and disk
// throughput are not utilization percentages. Explicit registered limits win.
export function inspectionThreshold(metric) {
  if (Number.isFinite(metric.inspectionThreshold)) return metric.inspectionThreshold;
  if (metric.unit === 'percent') {
    if (/(?:^|-)(cpu|memory)$/.test(metric.id)) return 90;
    if (/(?:^|-)disk$/.test(metric.id)) return 85;
    if (/(?:^|-)(availability|database)$/.test(metric.id)) return 99;
  }
  if (metric.unit === 's' && /(?:^|-)certificate$/.test(metric.id)) return 7 * 86400;
  return null;
}
