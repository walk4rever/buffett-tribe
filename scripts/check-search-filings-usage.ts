import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface ToolCall {
  name: string;
  arguments?: unknown;
}

function getPersistedToolCalls(context: unknown): ToolCall[] {
  if (!context || typeof context !== 'object' || Array.isArray(context)) return [];
  const toolCalls = (context as Record<string, unknown>).toolCalls;
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls.filter(
    (call): call is ToolCall =>
      typeof call === 'object' &&
      call !== null &&
      'name' in call &&
      typeof call.name === 'string',
  );
}

async function main() {
  // ChatTurn has no toolCalls column; inspect legacy context payloads only.
  const turns = await prisma.chatTurn.findMany({
    where: {
      role: 'assistant'
    },
    select: {
      id: true,
      contextKey: true,
      context: true,
      createdAt: true
    }
  });

  const searchFilingsCalls = turns.filter(turn => {
    const calls = getPersistedToolCalls(turn.context);
    return calls.some((call) => call.name === 'search_filings');
  });

  console.log('=== 已持久化上下文中的 search_filings 调用统计 ===\n');
  console.log('Assistant 对话轮次:', turns.length);
  console.log('调用 search_filings 的轮次:', searchFilingsCalls.length);
  console.log('提示：当前 ChatTurn 不持久化工具调用，以上仅统计旧 context 中保留的调用。');

  if (turns.length > 0) {
    console.log('调用比例:', ((searchFilingsCalls.length / turns.length) * 100).toFixed(2) + '%');
  }

  console.log('\n=== 最近10次调用详情 ===\n');
  searchFilingsCalls.slice(-10).forEach(turn => {
    const calls = getPersistedToolCalls(turn.context);
    const filingCall = calls.find((c) => c.name === 'search_filings');
    console.log('- 时间:', turn.createdAt.toISOString().split('T')[0]);
    console.log('  上下文:', turn.contextKey);
    console.log('  参数:', JSON.stringify(filingCall?.arguments, null, 2));
    console.log('');
  });

  // 统计所有工具的调用频率
  const toolStats = new Map<string, number>();
  turns.forEach(turn => {
    const calls = getPersistedToolCalls(turn.context);
    calls.forEach((call) => {
      toolStats.set(call.name, (toolStats.get(call.name) || 0) + 1);
    });
  });

  console.log('\n=== 所有工具调用频率排行 ===\n');
  const sortedTools = Array.from(toolStats.entries())
    .sort((a, b) => b[1] - a[1]);

  sortedTools.forEach(([tool, count]) => {
    const percentage = ((count / turns.length) * 100).toFixed(2);
    console.log(`${tool.padEnd(25)} ${count.toString().padStart(4)} 次  (${percentage}%)`);
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
