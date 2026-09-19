// Loki host labels differ from Prometheus instance labels on the NutsNews hosts.
export function logSelector(id, instance) {
  if (id === 'raspberry') return '{instance="rpi4",project="raspberry"}';
  const label = ['backend-vps', 'nutsnews-vps'].includes(id) ? 'host' : 'instance';
  return `{${label}=${JSON.stringify(instance)}}`;
}
