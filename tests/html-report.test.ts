import { describe, expect, it } from 'vitest';
import { analyzeCode, generateHtmlReport } from '../src/core/index.js';
import { EXAMPLES } from '../src/web/examples.js';

describe('Self-Contained Interactive HTML Report Generator', () => {
  it('generates a complete standalone offline HTML visualizer with embedded payload', () => {
    const result = analyzeCode(EXAMPLES[0].code, {
      language: EXAMPLES[0].language,
      fileName: EXAMPLES[0].fileName
    });
    const html = generateHtmlReport(result);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('CogTrace X-Ray Report');
    expect(html).toContain(EXAMPLES[0].fileName);
    expect(html).toContain('<style>');
    expect(html).toContain('<script>');
    expect(html).toContain('const DATA = ');
    // Self-contained check: must not depend on external scripts or stylesheets
    expect(html).not.toMatch(/<script\s+[^>]*src=/i);
    expect(html).not.toMatch(/<link\s+[^>]*rel=["']stylesheet["']/i);
  });

  it('safely escapes malicious HTML and closing </script> tags in source code and file names', () => {
    const nastyCode = `
export function renderSnippet() {
  const payload = "</script><img src=x onerror=alert(1)>";
  return payload;
}
`;
    const result = analyzeCode(nastyCode, {
      language: 'typescript',
      fileName: 'evil<script>alert(1)</script>.ts'
    });
    const html = generateHtmlReport(result);

    // Header must HTML-escape filename
    expect(html).toContain('evil&lt;script&gt;alert(1)&lt;/script&gt;.ts');
    // Embedded script JSON must escape `</script>` so script tag cannot terminate prematurely
    const scriptMatches = html.match(/<\/script>/gi) ?? [];
    expect(scriptMatches).toHaveLength(1);
    expect(html).toContain('\\u003c/script\\u003e');
  });
});
