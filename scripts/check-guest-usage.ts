import prisma from "../src/lib/prisma";

async function checkUsage() {
  const today = new Date().toISOString().split('T')[0];
  
  const usages = await prisma.chatUsage.findMany({
    where: {
      date: today,
      userId: null  // 匿名用户
    },
    orderBy: { count: 'desc' },
    take: 10
  });
  
  console.log(`Today (${today}) guest usage:`);
  if (usages.length === 0) {
    console.log('No usage records found');
  } else {
    usages.forEach(u => {
      console.log(`IP: ${u.ip} | Count: ${u.count}`);
    });
  }
  
  await prisma.$disconnect();
}

checkUsage();
