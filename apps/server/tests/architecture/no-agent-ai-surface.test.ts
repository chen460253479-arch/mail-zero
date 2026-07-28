import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const architectureRoot = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(architectureRoot, '../..');
const repositoryRoot = resolve(serverRoot, '../..');
const readSource = (path: string): string => readFileSync(resolve(repositoryRoot, path), 'utf8');

describe('Agent, Chat, Brain, and mail AI removal', () => {
  it('removes backend AI entrypoints and implementations instead of retaining stubs', () => {
    const retiredPaths = [
      'apps/server/src/trpc/routes/ai',
      'apps/server/src/trpc/routes/brain.ts',
      'apps/server/src/routes/ai.ts',
      'apps/server/src/routes/agent',
      'apps/server/src/routes/chat.ts',
      'apps/server/src/lib/brain.ts',
      'apps/server/src/lib/brain.fallback.prompts.ts',
      'apps/server/src/lib/sequential-thinking.ts',
      'apps/server/src/pipelines.ts',
      'apps/server/src/pipelines.effect.ts',
      'apps/server/src/thread-workflow-utils',
      'apps/server/src/workflows/sync-threads-workflow.ts',
      'apps/server/src/workflows/sync-threads-coordinator-workflow.ts',
      'apps/server/src/services/call-service',
      'apps/server/src/services/writing-style-service.ts',
      'apps/server/src/lib/analyze/interests.ts',
      'apps/server/src/lib/prompts.ts',
      'apps/server/src/lib/react-emails/email-sequences.tsx',
      'apps/server/evals',
      'scripts/register-elevenlabs-tools.ts',
      'MCP.md',
    ];

    expect(retiredPaths.filter((path) => existsSync(resolve(repositoryRoot, path)))).toEqual([]);
  });

  it('does not expose AI, Agent, Brain, SSE, or MCP server routes', () => {
    const main = readSource('apps/server/src/main.ts');
    const trpc = readSource('apps/server/src/trpc/index.ts');
    const forbiddenMainTokens = [
      "route('/ai'",
      "mount('/sse'",
      "mount('/mcp'",
      'agentsMiddleware',
      'ZeroAgent',
      'ZeroMCP',
      'ThinkingMCP',
      'WorkflowRunner',
      'THREAD_SYNC_WORKER',
      'enableBrainFunction',
    ];
    const forbiddenTrpcTokens = [
      "from './routes/ai'",
      "from './routes/brain'",
      'ai: aiRouter',
      'brain: brainRouter',
    ];

    expect(forbiddenMainTokens.filter((token) => main.includes(token))).toEqual([]);
    expect(forbiddenTrpcTokens.filter((token) => trpc.includes(token))).toEqual([]);
  });

  it('removes frontend AI, voice-agent, summary, and natural-language search surfaces', () => {
    const retiredPaths = [
      'apps/mail/components/ai-toggle-button.tsx',
      'apps/mail/components/create/ai-chat.tsx',
      'apps/mail/components/ui/ai-sidebar.tsx',
      'apps/mail/components/ui/prompts-dialog.tsx',
      'apps/mail/components/voice-button.tsx',
      'apps/mail/hooks/use-summary.ts',
      'apps/mail/lib/elevenlabs-tools.ts',
      'apps/mail/lib/prompts.ts',
      'apps/mail/lib/server-tool.ts',
      'apps/mail/providers/voice-provider.tsx',
      'apps/mail/public/ai.svg',
      'apps/mail/public/ai-chat.png',
      'apps/mail/public/ai-summary.png',
      'apps/mail/public/claude.png',
      'apps/mail/public/openai.png',
      'apps/mail/components/setup-phone.tsx',
      'apps/mail/types/tools.ts',
      'packages/testing/e2e/ai-summary.spec.ts',
      'packages/testing/e2e/bulk-search.spec.ts',
    ];
    const frontendEntrypoints = [
      'apps/mail/components/context/command-palette-context.tsx',
      'apps/mail/components/create/email-composer.tsx',
      'apps/mail/components/mail/mail-display.tsx',
      'apps/mail/components/mail/mail.tsx',
      'apps/mail/components/mail/thread-display.tsx',
      'apps/mail/components/ui/app-sidebar.tsx',
      'apps/mail/components/home/footer.tsx',
      'apps/mail/app/(full-width)/about.tsx',
    ];
    const forbiddenTokens = [
      'trpc.ai',
      'trpc.brain',
      'useAISidebar',
      'useAIFullScreen',
      'AIToggleButton',
      'useSummary',
      'webSearch',
      'aiCompose',
      'generateEmailSubject',
      'generateSearchQuery',
      'Zero AI',
      'Chat with Zero',
      'AI-powered',
    ];
    const violations = frontendEntrypoints.flatMap((path) => {
      const source = readSource(path);
      return forbiddenTokens
        .filter((token) => source.includes(token))
        .map((token) => `${path}:${token}`);
    });

    expect(retiredPaths.filter((path) => existsSync(resolve(repositoryRoot, path)))).toEqual([]);
    expect(violations).toEqual([]);
  });

  it('removes direct Agent, AI, MCP, and voice dependencies from application manifests', () => {
    const manifests = ['apps/mail/package.json', 'apps/server/package.json'].map((path) => ({
      path,
      source: readSource(path),
    }));
    const forbiddenDependencies = [
      '@ai-sdk/',
      '@elevenlabs/',
      '@modelcontextprotocol/',
      '"agents"',
      '"ai"',
      '"dormroom"',
      '"hono-agents"',
      '"hono-party"',
      '"partyserver"',
      '"twilio"',
      '"autoevals"',
      '"evalite"',
    ];
    const violations = manifests.flatMap(({ path, source }) =>
      forbiddenDependencies
        .filter((dependency) => source.includes(dependency))
        .map((dependency) => `${path}:${dependency}`),
    );

    expect(violations).toEqual([]);
  });

  it('removes Live Support, Feedback, and their dedicated third-party runtime', () => {
    const sources = [
      'apps/mail/components/ui/nav-main.tsx',
      'apps/mail/components/icons/icons.tsx',
      'apps/mail/package.json',
      'apps/server/src/trpc/routes/user.ts',
      'apps/server/package.json',
    ].map((path) => ({ path, source: readSource(path) }));
    const forbiddenTokens = [
      '@intercom/messenger-js-sdk',
      '@tsndr/cloudflare-worker-jwt',
      'getIntercomToken',
      'feedback.0.email',
      'Live Support',
      'OldPhone',
      'MessageSquare',
    ];
    const sourceViolations = sources.flatMap(({ path, source }) =>
      forbiddenTokens.filter((token) => source.includes(token)).map((token) => `${path}:${token}`),
    );
    const localeViolations = readdirSync(resolve(repositoryRoot, 'apps/mail/messages'))
      .filter((file) => file.endsWith('.json'))
      .flatMap((file) => {
        const source = readSource(`apps/mail/messages/${file}`);
        return ['"livesupport":', '"feedback":']
          .filter((token) => source.includes(token))
          .map((token) => `apps/mail/messages/${file}:${token}`);
      });

    expect([...sourceViolations, ...localeViolations]).toEqual([]);
  });
});
