/**
 * Unit tests for iframe/export-responses.js
 *
 * Covers: generatePreview, cleanExtractedText, isThinkingContent,
 *         escapeHtmlExport, generateExportContent (partial).
 *
 * These are pure functions extracted and tested in isolation.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// --- Extract pure functions from export-responses.js ---
const src = fs.readFileSync(path.join(__dirname, '..', 'iframe', 'export-responses.js'), 'utf8');

function extractFunction(name, source) {
  const marker = `function ${name}(`;
  const startIdx = source.indexOf(marker);
  if (startIdx === -1) throw new Error(`Function ${name} not found`);
  let braceCount = 0, endIdx = startIdx, started = false;
  for (let i = startIdx; i < source.length; i++) {
    if (source[i] === '{') { braceCount++; started = true; }
    if (source[i] === '}') { braceCount--; }
    if (started && braceCount === 0) { endIdx = i + 1; break; }
  }
  return source.slice(startIdx, endIdx);
}

// Extract functions
const cleanExtractedTextFn = new Function('return ' + extractFunction('cleanExtractedText', src))();
const escapeHtmlExportFn = new Function('return ' + extractFunction('escapeHtmlExport', src))();
const generatePreviewFn = new Function('return ' + extractFunction('generatePreview', src))();

// isThinkingContent needs a mock element; extract differently
const isThinkingContentSrc = extractFunction('isThinkingContent', src);
const isThinkingContentFn = new Function('return ' + isThinkingContentSrc)();

// Mock minimal DOM element for isThinkingContent tests
function createMockElement(opts = {}) {
  return {
    classList: { contains: (cls) => (opts.classes || []).includes(cls) },
    querySelector: () => opts.hasSubElement ? {} : null,
    hasAttribute: (attr) => (opts.attributes || []).includes(attr)
  };
}

describe('cleanExtractedText', () => {
  it('trims whitespace', () => {
    assert.equal(cleanExtractedTextFn('  hello world  '), 'hello world');
  });

  it('collapses multiple spaces', () => {
    assert.equal(cleanExtractedTextFn('hello    world'), 'hello world');
  });

  it('removes "Loading..." patterns', () => {
    assert.equal(cleanExtractedTextFn('Loading...'), '');
    assert.equal(cleanExtractedTextFn('Please wait...'), '');
    assert.equal(cleanExtractedTextFn('Generating...'), '');
    assert.equal(cleanExtractedTextFn('Thinking...'), '');
    assert.equal(cleanExtractedTextFn('Processing...'), '');
  });

  it('returns empty string for falsy input', () => {
    assert.equal(cleanExtractedTextFn(''), '');
    assert.equal(cleanExtractedTextFn(null), '');
    assert.equal(cleanExtractedTextFn(undefined), '');
  });

  it('preserves normal text', () => {
    assert.equal(cleanExtractedTextFn('Hello, this is a response.'), 'Hello, this is a response.');
  });
});

describe('escapeHtmlExport', () => {
  it('escapes & < > " \'', () => {
    assert.equal(escapeHtmlExportFn('&'), '&amp;');
    assert.equal(escapeHtmlExportFn('<'), '&lt;');
    assert.equal(escapeHtmlExportFn('>'), '&gt;');
    assert.equal(escapeHtmlExportFn('"'), '&quot;');
    assert.equal(escapeHtmlExportFn("'"), '&#39;');
  });

  it('escapes combined HTML content', () => {
    assert.equal(
      escapeHtmlExportFn('<script>alert("xss")</script>'),
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
  });

  it('returns empty string for null/undefined', () => {
    assert.equal(escapeHtmlExportFn(null), '');
    assert.equal(escapeHtmlExportFn(undefined), '');
  });

  it('converts numbers to string', () => {
    assert.equal(escapeHtmlExportFn(42), '42');
  });
});

describe('generatePreview', () => {
  const sampleResponses = [
    { siteName: 'ChatGPT', content: 'Hello from ChatGPT with some long content that goes on and on...', url: 'https://chat.openai.com/c/123' },
    { siteName: 'Gemini', content: 'Gemini response here', url: 'https://gemini.google.com/app/456' }
  ];

  it('returns empty message for no responses', () => {
    assert.equal(generatePreviewFn([], 'markdown'), '没有找到可导出的内容');
  });

  it('generates markdown format preview', () => {
    const preview = generatePreviewFn(sampleResponses, 'markdown');
    assert.ok(preview.includes('## ChatGPT'));
    assert.ok(preview.includes('## Gemini'));
    assert.ok(preview.includes('https://chat.openai.com/c/123'));
    assert.ok(preview.includes('---'));
  });

  it('generates html format preview', () => {
    const preview = generatePreviewFn(sampleResponses, 'html');
    assert.ok(preview.includes('<h3>ChatGPT</h3>'));
    assert.ok(preview.includes('<h3>Gemini</h3>'));
    assert.ok(preview.includes('<hr>'));
  });

  it('generates txt format preview', () => {
    const preview = generatePreviewFn(sampleResponses, 'txt');
    assert.ok(preview.includes('ChatGPT:'));
    assert.ok(preview.includes('Gemini:'));
    assert.ok(preview.includes('='.repeat(30)));
  });

  it('truncates long content with ellipsis', () => {
    const longContent = 'A'.repeat(200);
    const responses = [{ siteName: 'Test', content: longContent, url: 'https://example.com' }];
    const preview = generatePreviewFn(responses, 'markdown');
    assert.ok(preview.includes('...'));
    assert.ok(!preview.includes(longContent)); // full content should not be present
  });

  it('does not show URL when url is "unknown"', () => {
    const responses = [{ siteName: 'Test', content: 'content', url: 'unknown' }];
    const preview = generatePreviewFn(responses, 'markdown');
    assert.ok(!preview.includes('**URL:**'));
  });
});

describe('isThinkingContent', () => {
  it('detects English thinking keywords', () => {
    const el = createMockElement();
    assert.ok(isThinkingContentFn('Let me think about this carefully...', el));
  });

  it('detects Chinese thinking keywords', () => {
    const el = createMockElement();
    assert.ok(isThinkingContentFn('让我思考一下这个问题...', el));
  });

  it('detects [thinking] marker format', () => {
    const el = createMockElement();
    assert.ok(isThinkingContentFn('[Thinking] about the problem', el));
  });

  it('detects *thinking* markdown format', () => {
    const el = createMockElement();
    assert.ok(isThinkingContentFn('*thinking* about it', el));
  });

  it('detects DOM features: thinking class', () => {
    const el = createMockElement({ classes: ['thinking'] });
    assert.ok(isThinkingContentFn('some text', el));
  });

  it('detects DOM features: data-thinking attribute', () => {
    const el = createMockElement({ attributes: ['data-thinking'] });
    assert.ok(isThinkingContentFn('some text', el));
  });

  it('detects DOM features: data-internal attribute', () => {
    const el = createMockElement({ attributes: ['data-internal'] });
    assert.ok(isThinkingContentFn('some text', el));
  });

  it('returns false for normal content without thinking markers', () => {
    const el = createMockElement();
    assert.ok(!isThinkingContentFn('The answer to your question is 42.', el));
  });

  it('detects French/Spanish thinking keywords', () => {
    const el = createMockElement();
    assert.ok(isThinkingContentFn('Voici ma réflexion sur le sujet', el));
    assert.ok(isThinkingContentFn('Mi análisis del problema', el));
  });
});
