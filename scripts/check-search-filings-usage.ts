import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 查询 ChatTurn 中所有包含 toolCalls 的对话轮次
  const turns = await prisma.chatTurn.findMany({
    where: {
      role: 'assistant',
      toolCalls: { not: null }
    },
    select: {
      id: true,
      contextKey: true,
      toolCalls: true,
      createdAt: true
    }
  });

  interface ToolCall {
    name: string;
    arguments?: unknown;
  }

  const searchFilingsCalls = turns.filter(turn => {
    if (!turn.toolCalls) return false;
    const calls = (typeof turn.toolCalls === 'string'
      ? JSON.parse(turn.toolCalls)
      : turn.toolCalls) as ToolCall[];
    return calls.some((call) => call.name === 'search_filings');
  });

  console.log('=== search_filings 工具调用统计 ===\n');
  console.log('总对话轮次（含 toolCalls）:', turns.length);
  console.log('调用 search_filings 的轮次:', searchFilingsCalls.length);

  if (turns.length > 0) {
    console.log('调用比例:', ((searchFilingsCalls.length / turns.length) * 100).toFixed(2) + '%');
  }

  console.log('\n=== 最近10次调用详情 ===\n');
  searchFilingsCalls.slice(-10).forEach(turn => {
    const calls = (typeof turn.toolCalls === 'string'
      ? JSON.parse(turn.toolCalls)
      : turn.toolCalls) as ToolCall[];
    const filingCall = calls.find((c) => c.name === 'search_filings');
    console.log('- 时间:', turn.createdAt.toISOString().split('T')[0]);
    console.log('  上下文:', turn.contextKey);
    console.log('  参数:', JSON.stringify(filingCall?.arguments, null, 2));
    console.log('');
  });

  // 统计所有工具的调用频率
  const toolStats = new Map<string, number>();
  turns.forEach(turn => {
    if (!turn.toolCalls) return;
    const calls = (typeof turn.toolCalls === 'string'
      ? JSON.parse(turn.toolCalls)
      : turn.toolCalls) as ToolCall[];
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
