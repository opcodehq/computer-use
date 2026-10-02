export type ReadinessInput = {
  platform: string;
  executable: boolean;
  credential: { source: string; error?: string };
  status?: unknown;
  error?: string;
};

type Check = { name: string; state: 'ok' | 'required' | 'optional'; detail: string };

/** Diagnose the actual host; installing a skill is not proof that input is ready. */
export function readiness(input: ReadinessInput) {
  if (input.platform === 'linux') {
    const status = input.status as { permissions?: { displayReady?: boolean; isolated?: boolean; visual?: { modelInstalled?: boolean } } } | undefined;
    const checks: Check[] = [
      { name: 'Native driver', state: input.executable ? 'ok' : 'required', detail: 'Build with bun run setup:linux.' },
      { name: 'Isolated desktop', state: status?.permissions?.displayReady && status.permissions.isolated ? 'ok' : 'required', detail: 'Start the agent inside bun run desktop:linux -- <agent command>.' },
      { name: 'YOLO model', state: status?.permissions?.visual?.modelInstalled ? 'ok' : 'required', detail: 'Install the pinned model with bun run setup:linux.' },
    ];
    const ready = checks.every(check => check.state !== 'required');
    return { ready, jevReady: ready && input.credential.source !== 'missing', checks };
  }
  const status = input.status as { permissions?: { accessibility?: boolean; screenRecording?: boolean; permissionOwner?: string; visual?: { modelInstalled?: boolean } } } | undefined;
  const checks: Check[] = [
    { name: 'Mac host', state: input.platform === 'darwin' ? 'ok' : 'required', detail: input.platform === 'darwin' ? 'Running on macOS.' : 'Run on the Mac being controlled, through its local shell or your harness Mac command bridge.' },
    { name: 'Native driver', state: input.executable ? 'ok' : 'required', detail: input.executable ? 'Native driver is executable.' : 'Run bun run build:native from the Jev checkout on your Mac.' },
    { name: 'Accessibility', state: status?.permissions?.accessibility === true ? 'ok' : 'required', detail: status?.permissions?.accessibility === true ? `Granted to ${status.permissions?.permissionOwner ?? 'this command host'}.` : input.error ?? 'Run cu permission on the Mac. For npm installs, enable Opcode in System Settings → Privacy & Security → Accessibility, then restart that host if requested.' },
    { name: 'TypeSafe key', state: input.credential.source !== 'missing' ? 'ok' : 'optional', detail: input.credential.source !== 'missing' ? `Loaded from ${input.credential.source}; validity is checked on the first Jev request.` : input.credential.error ?? 'Run jev auth to save your TypeSafe key. Exact native actions and external agent tasks work without a TypeSafe key. Only Jev selection requires it.' },
    { name: 'Local detector', state: status?.permissions?.visual?.modelInstalled ? 'ok' : 'optional', detail: 'cu install downloads the checksum-pinned ONNX detector on macOS. Apple OCR remains available if model inference fails.' },
    { name: 'Optional Capture', state: status?.permissions?.screenRecording === true ? 'ok' : 'optional', detail: status?.permissions?.screenRecording === true ? `Capture available to ${status.permissions?.permissionOwner ?? 'this command host'}.` : 'Run cu capture-permission. For npm installs, grant Screen Recording to Opcode; then start a fresh CU session if macOS requests a restart.' },
  ];
  const ready = checks.every(check => check.state !== 'required');
  return { ready, jevReady: ready && input.credential.source !== 'missing', checks };
}

export function formatReadiness(report: ReturnType<typeof readiness>) {
  return report.checks.map(check => `${check.state === 'ok' ? '✓' : check.state === 'optional' ? '○' : '!'} ${check.name}: ${check.detail}`).join('\n');
}
