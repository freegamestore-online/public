import type { ViewportTestExpanded } from './screencheck-matrix.js';

interface MeasureResult {
  label: string;
  width: number;
  height: number;
  scrollWidth: number;
  scrollHeight: number;
  scrollsX: boolean;
  scrollsY: boolean;
  clippingElements: Array<{
    tag: string;
    cls: string;
    id: string | null;
    scrollW: number;
    scrollH: number;
    clientW: number;
    clientH: number;
    clipsX: boolean;
    clipsY: boolean;
  }>;
}

export function renderCoverage(
  cov: {
    portrait: number;
    landscape: number;
    overall: number;
    brokenSizes: ViewportTestExpanded[];
  },
  matrix: ViewportTestExpanded[],
): void {
  const isTTY = Boolean(process.stdout.isTTY) && process.env.NO_COLOR !== '1';
  const c = (open: string) => (s: string) => (isTTY ? `\x1b[${open}m${s}\x1b[39m` : s);
  const ok = c('32');
  const warn = c('33');
  const bad = c('31');
  const colorize = (pct: number): ((s: string) => string) =>
    pct >= 95 ? ok : pct >= 80 ? warn : bad;

  const hasPortrait = matrix.some((t) => t.orientation === 'portrait');
  const hasLandscape = matrix.some((t) => t.orientation === 'landscape');
  process.stdout.write('Device coverage:\n');
  if (hasPortrait) {
    process.stdout.write(
      `  portrait:  ${colorize(cov.portrait)(`~${cov.portrait}%`)} of devices\n`,
    );
  }
  if (hasLandscape) {
    process.stdout.write(
      `  landscape: ${colorize(cov.landscape)(`~${cov.landscape}%`)} of devices\n`,
    );
  }
  if (hasPortrait && hasLandscape) {
    process.stdout.write(
      `  overall:   ${colorize(cov.overall)(`~${cov.overall}%`)} (worst-case across orientations)\n`,
    );
  }
}

export function renderResult(r: MeasureResult): void {
  const isTTY = Boolean(process.stdout.isTTY) && process.env.NO_COLOR !== '1';
  const c = (open: string) => (s: string) => (isTTY ? `\x1b[${open}m${s}\x1b[39m` : s);
  const ok = c('32');
  const bad = c('31');
  const dim = (s: string) => (isTTY ? `\x1b[2m${s}\x1b[22m` : s);

  const hasIssue = r.scrollsX || r.scrollsY || r.clippingElements.length > 0;
  if (!hasIssue) {
    process.stdout.write(`  ${ok('✓')} ${r.label.padEnd(40)} ${dim(`fits cleanly`)}\n`);
    return;
  }
  const issues: string[] = [];
  if (r.scrollsX) issues.push(`scrolls horizontally (${r.scrollWidth}px > ${r.width}px)`);
  if (r.scrollsY) issues.push(`scrolls vertically (${r.scrollHeight}px > ${r.height}px)`);
  if (r.clippingElements.length > 0) {
    issues.push(`${r.clippingElements.length} element(s) clip content`);
  }
  process.stdout.write(`  ${bad('✗')} ${r.label.padEnd(40)} ${dim(issues.join(' · '))}\n`);
  for (const el of r.clippingElements.slice(0, 3)) {
    const sel = el.id ? `#${el.id}` : el.cls ? `.${el.cls.split(/\s+/)[0]}` : '';
    const detail: string[] = [];
    if (el.clipsX) detail.push(`x:${el.scrollW}>${el.clientW}`);
    if (el.clipsY) detail.push(`y:${el.scrollH}>${el.clientH}`);
    process.stdout.write(`      ${dim(`<${el.tag}${sel}>`)} ${dim(detail.join(' '))}\n`);
  }
}
